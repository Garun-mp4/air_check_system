from __future__ import annotations

import logging
import math
from typing import Any

from aircheck_simulator_3d.app.config import AppConfig, load_config
from aircheck_simulator_3d.app.coordinator import SimulationCoordinator
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.networking.contracts import BackendForecast
from aircheck_simulator_3d.networking.workers import NetworkIntegration
from aircheck_simulator_3d.presentation.visualization_mode import VisualizationMode
from aircheck_simulator_3d.simulation.engine import SimulationEngine


LOGGER = logging.getLogger("aircheck.application.runtime")


class ApplicationRuntime:
    """Panda3D adapter around the shared, presentation-independent coordinator."""

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
        self._config = config or load_config()
        self._coordinator = SimulationCoordinator(
            self._config,
            network,
            devices=devices,
            simulation=simulation,
        )
        if clock is None:
            from panda3d.core import ClockObject

            clock = ClockObject.getGlobalClock()
        self._clock = clock
        self._closed = False
        self._events: list[str] = []
        controls = (
            ("o", "window_open"),
            ("k", "window_close"),
            ("i", "intake_toggle"),
            ("x", "exhaust_toggle"),
            ("v", "filter_toggle"),
            ("space", "pause"),
        )
        for key, action in controls:
            base.accept(key, lambda action=action: self._run_if_input_open(self._local, action))
            self._events.append(key)
        for key, speed in enumerate(simulation.supported_speeds, start=1):
            event = str(key)
            base.accept(event, lambda speed=speed: self._run_if_input_open(self._set_speed, speed))
            self._events.append(event)
        self._task = base.taskMgr.add(self._update, "aircheck-device-runtime", sort=10)
        self._viewport.set_simulation_speed(simulation.state.simulation_speed)
        self._viewport.apply_device_state(devices.presentation_state, 0.0)
        if hasattr(viewport, "set_action_handlers"):
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

    def _local(self, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._coordinator.execute_local(action, payload)

    def _set_speed(self, speed: float) -> None:
        self._local("speed", {"speed": speed})
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)

    def _toggle_pause(self) -> None:
        self._local("pause")
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)

    def _apply_scenario(self, scenario_id: str) -> None:
        result = self._local("scenario", {"scenario_id": scenario_id})
        self._viewport.set_scenario_name(str(result["title"]))
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)

    def _start_demo(self) -> None:
        self._local("demo_start")
        self._viewport.set_scenario_name("Automatic demo")
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)

    def _stop_demo(self) -> None:
        self._local("demo_stop")

    def _adjust_parameter(self, name: str, direction: int) -> None:
        if name == "simulation_speed":
            self._step_speed(direction)
        else:
            result = self._local("debug_adjust", {"key": name, "direction": direction})
            LOGGER.info("Developer control %s changed to %s", name, result["value"])

    def _step_speed(self, direction: int) -> None:
        result = self._local("speed_step", {"direction": direction})
        self._viewport.set_simulation_speed(float(result["speed"]))

    def _set_visualization_mode(self, mode: VisualizationMode) -> None:
        self._viewport.set_visualization_mode(mode)

    def _run_if_input_open(self, callback: Any, *args: Any) -> None:
        if not bool(getattr(self._viewport, "input_blocked", False)):
            callback(*args)

    def _update(self, task: Any) -> Any:
        raw_delta = float(self._clock.getDt())
        delta_seconds = max(raw_delta, 0.0) if math.isfinite(raw_delta) else 0.0
        self._coordinator.tick(delta_seconds)
        self._viewport.apply_device_state(self._devices.presentation_state, delta_seconds)
        if hasattr(self._viewport, "set_backend_status"):
            forecast = BackendForecast.from_mapping(self._coordinator.forecast)
            self._viewport.set_backend_status(
                self._coordinator.backend_online,
                forecast,
                self._coordinator.backend_message,
            )
        if hasattr(self._viewport, "set_last_telemetry"):
            self._viewport.set_last_telemetry(self._coordinator.last_telemetry_at)
        self._push_ui_snapshot()
        return task.cont

    def _push_ui_snapshot(self) -> None:
        if not hasattr(self._viewport, "update_application_state"):
            return
        self._viewport.update_application_state(
            self._simulation.state,
            pending_commands=self._coordinator.command_executor.pending_count,
            last_telemetry_at=self._coordinator.last_telemetry_at,
            developer_values=self._coordinator.developer.values(),
            demo_status=self._coordinator.demo.status,
        )
        self._viewport.set_scenario_name(self._coordinator.scenarios.active_scenario)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._base.taskMgr.remove(self._task)
        for event in self._events:
            self._base.ignore(event)
        self._events.clear()
        self._coordinator.close(close_network=False)
