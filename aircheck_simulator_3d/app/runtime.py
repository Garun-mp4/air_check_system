from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timezone
from typing import Any

from aircheck_simulator_3d.app.automatic_demo import AutomaticDemoController
from aircheck_simulator_3d.app.config import AppConfig
from aircheck_simulator_3d.app.developer_controls import DeveloperControls
from aircheck_simulator_3d.app.scenarios import ScenarioController
from aircheck_simulator_3d.devices.command_executor import DeviceCommandExecutor
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.networking.contracts import ControlStateReport, MeasurementPayload
from aircheck_simulator_3d.networking.workers import (
    AcknowledgementAccepted,
    BackendStatusUpdate,
    CommandReceived,
    NetworkIntegration,
    TelemetryAccepted,
)
from aircheck_simulator_3d.presentation.visualization_mode import VisualizationMode
from aircheck_simulator_3d.simulation.engine import SimulationEngine
from aircheck_simulator_3d.simulation.virtual_sensors import SensorReadingUnavailable


LOGGER = logging.getLogger("aircheck.application.runtime")


class ApplicationRuntime:
    """Connects core state with Panda presentation and backend events."""

    def __init__(
        self,
        base: Any,
        devices: DeviceLayer,
        viewport: Any,
        simulation: SimulationEngine,
        clock: Any | None = None,
        network: NetworkIntegration | None = None,
        config: AppConfig | None = None,
    ) -> None:
        self._base = base
        self._devices = devices
        self._viewport = viewport
        self._simulation = simulation
        self._network = network
        self._config = config
        self._command_executor = DeviceCommandExecutor(devices)
        self._next_telemetry_at = time.monotonic()
        self._backend_online = devices.simulation_state.controller.online
        self._forecast = None
        self._last_telemetry_at: str | None = None
        self._scenario_controller = (
            ScenarioController(config, simulation, devices, network) if config is not None else None
        )
        self._developer_controls = (
            DeveloperControls(config, simulation, devices) if config is not None else None
        )
        self._automatic_demo = AutomaticDemoController(config.demo) if config is not None else None
        if clock is None:
            from panda3d.core import ClockObject

            clock = ClockObject.getGlobalClock()
        self._clock = clock
        self._closed = False
        self._events: list[str] = []
        controls = (
            ("o", lambda: self._run_if_input_open(devices.request_window_open)),
            ("k", lambda: self._run_if_input_open(devices.request_window_close)),
            ("i", lambda: self._run_if_input_open(devices.toggle_intake)),
            ("x", lambda: self._run_if_input_open(devices.toggle_exhaust)),
            ("v", lambda: self._run_if_input_open(devices.toggle_filter)),
            ("space", lambda: self._run_if_input_open(self._toggle_pause)),
        )
        for key, callback in controls:
            base.accept(key, callback)
            self._events.append(key)
        for key, speed in enumerate(simulation.supported_speeds, start=1):
            event = str(key)
            base.accept(event, lambda speed=speed: self._run_if_input_open(self._set_speed, speed))
            self._events.append(event)
        self._task = base.taskMgr.add(self._update, "aircheck-device-runtime", sort=10)
        self._viewport.set_simulation_speed(simulation.state.simulation_speed)
        viewport.apply_device_state(devices.presentation_state, 0.0)
        if config is not None and hasattr(viewport, "set_action_handlers"):
            viewport.set_action_handlers(
                toggle_simulation=self._toggle_pause,
                scenario=self._apply_scenario,
                start_demo=self._start_demo,
                stop_demo=self._stop_demo,
                adjust=self._adjust_parameter,
                speed_step=self._step_speed,
                visualization_mode=self._set_visualization_mode,
            )
            self._push_ui_snapshot()

    def _set_speed(self, speed: float) -> None:
        self._simulation.set_speed(speed)
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)

    def _toggle_pause(self) -> None:
        self._simulation.toggle_pause()
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)

    def _apply_scenario(self, scenario_id: str) -> None:
        if self._scenario_controller is None:
            return
        if self._automatic_demo is not None:
            self._automatic_demo.stop()
        preset = self._scenario_controller.apply(scenario_id)
        self._viewport.set_scenario_name(preset.title)
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)
        LOGGER.info("Demo scenario selected: %s", preset.scenario_id)

    def _start_demo(self) -> None:
        if self._scenario_controller is None or self._automatic_demo is None:
            return
        self._scenario_controller.prepare_automatic_demo()
        self._automatic_demo.start(self._simulation.state)
        self._viewport.set_scenario_name("Automatic demo")
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)
        LOGGER.info("Automatic backend-driven demonstration started")

    def _stop_demo(self) -> None:
        if self._automatic_demo is not None:
            self._automatic_demo.stop()

    def _adjust_parameter(self, name: str, direction: int) -> None:
        if name == "simulation_speed":
            self._step_speed(direction)
        elif self._developer_controls is not None:
            value = self._developer_controls.adjust(name, direction)
            LOGGER.info("Developer control %s changed to %s", name, value)

    def _step_speed(self, direction: int) -> None:
        if self._developer_controls is not None:
            speed = self._developer_controls.step_simulation_speed(direction)
            self._viewport.set_simulation_speed(speed)

    def _set_visualization_mode(self, mode: VisualizationMode) -> None:
        self._viewport.set_visualization_mode(mode)

    def _run_if_input_open(self, callback: Any, *args: Any) -> None:
        if not bool(getattr(self._viewport, "input_blocked", False)):
            callback(*args)

    def _update(self, task: Any) -> Any:
        raw_delta = float(self._clock.getDt())
        delta_seconds = max(raw_delta, 0.0) if math.isfinite(raw_delta) else 0.0
        self._drain_network_events()
        self._simulation.advance(delta_seconds)
        completed_ids = self._command_executor.update()
        if self._automatic_demo is not None:
            self._automatic_demo.command_applied(completed_ids)
            for command in self._command_executor.active_commands:
                self._automatic_demo.command_started(command.command_id)
        if self._network is not None:
            now = datetime.now(timezone.utc)
            if completed_ids:
                LOGGER.info(
                    "Backend command(s) completed from actual device state: ids=%s window=%.1f%% reed=%s intake=%s exhaust=%s",
                    completed_ids,
                    self._devices.simulation_state.window.actual_position_percent,
                    self._devices.simulation_state.window.reed_switch,
                    self._devices.simulation_state.ventilation.intake.enabled,
                    self._devices.simulation_state.ventilation.exhaust.enabled,
                )
                report = ControlStateReport.from_state(
                    self._network.device_id,
                    now,
                    self._devices.simulation_state,
                    completed_ids,
                )
                self._network.acknowledge(report)
            self._network.publish_actual_state(
                ControlStateReport.from_state(
                    self._network.device_id,
                    now,
                    self._devices.simulation_state,
                )
            )
            monotonic_now = time.monotonic()
            if monotonic_now >= self._next_telemetry_at:
                try:
                    payload = MeasurementPayload.from_state(self._simulation.state, now)
                except SensorReadingUnavailable as exc:
                    LOGGER.info("Virtual sensor telemetry withheld: %s", exc)
                except ValueError as exc:
                    LOGGER.warning("Virtual sensor telemetry is incomplete: %s", exc)
                else:
                    self._network.publish_telemetry(payload)
                self._next_telemetry_at = monotonic_now + self._network.config.telemetry_interval_seconds
        self._viewport.apply_device_state(self._devices.presentation_state, delta_seconds)
        self._push_ui_snapshot()
        return task.cont

    def _drain_network_events(self) -> None:
        if self._network is None:
            return
        state = self._devices.simulation_state
        for event in self._network.drain_events():
            if isinstance(event, CommandReceived):
                self._command_executor.enqueue(event.command)
                LOGGER.info(
                    "Backend command received: id=%s target=%s desired_state=%s source=%s",
                    event.command.command_id,
                    event.command.target.value,
                    event.command.desired_state,
                    event.command.source or "unknown",
                )
                if self._automatic_demo is not None:
                    self._automatic_demo.command_received(event.command.command_id)
            elif isinstance(event, AcknowledgementAccepted):
                self._command_executor.acknowledgement_accepted(event.command_ids)
                if self._automatic_demo is not None:
                    self._automatic_demo.acknowledgement_accepted(event.command_ids)
            elif isinstance(event, BackendStatusUpdate):
                self._backend_online = event.online
                self._forecast = event.forecast
                state.controller.online = event.online
                state.controller.last_seen_at = event.last_seen_at
                self._viewport.set_backend_status(event.online, event.forecast, event.message)
            elif isinstance(event, TelemetryAccepted):
                self._last_telemetry_at = event.accepted_at
                self._forecast = event.forecast or self._forecast
                self._viewport.set_last_telemetry(event.accepted_at)
                if self._automatic_demo is not None:
                    self._automatic_demo.forecast_received(event.forecast)

    def _push_ui_snapshot(self) -> None:
        if self._config is None or not hasattr(self._viewport, "update_application_state"):
            return
        status = (
            self._automatic_demo.update(self._simulation.state, self._backend_online)
            if self._automatic_demo is not None
            else None
        )
        self._viewport.update_application_state(
            self._simulation.state,
            pending_commands=self._command_executor.pending_count,
            last_telemetry_at=self._last_telemetry_at,
            developer_values=self._developer_controls.values() if self._developer_controls is not None else {},
            demo_status=status,
        )
        if self._scenario_controller is not None:
            self._viewport.set_scenario_name(self._scenario_controller.active_scenario)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._base.taskMgr.remove(self._task)
        for event in self._events:
            self._base.ignore(event)
        self._events.clear()
