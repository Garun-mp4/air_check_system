from __future__ import annotations

import logging
import math
import queue
import threading
import time
from concurrent.futures import Future
from dataclasses import asdict
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
from aircheck_simulator_3d.scene.device_models.layout import (
    CONTROL_CABINET_HEIGHT_M,
    CONTROL_CABINET_WIDTH_M,
    INDOOR_MOUNT_PANEL_HEIGHT_M,
    INDOOR_MOUNT_PANEL_WIDTH_M,
    EquipmentLayout,
)
from aircheck_simulator_3d.simulation.engine import SimulationEngine
from aircheck_simulator_3d.simulation.factory import create_initial_state
from aircheck_simulator_3d.simulation.virtual_sensors import SensorReadingUnavailable, read_sensor_value


LOGGER = logging.getLogger("aircheck.simulator.coordinator")


class SimulationCoordinator:
    """Presentation-independent owner of the simulation, devices and backend lifecycle."""

    def __init__(
        self,
        config: AppConfig,
        network: NetworkIntegration | None = None,
        *,
        devices: DeviceLayer | None = None,
        simulation: SimulationEngine | None = None,
    ) -> None:
        self.config = config
        if devices is None or simulation is None:
            state = create_initial_state(config)
            devices = devices or DeviceLayer(state, config.devices)
            simulation = simulation or SimulationEngine(state, devices, config.physics, config.scene)
        self.devices = devices
        self.simulation = simulation
        self._owns_network = network is None
        self._started_network = False
        self.network = network or NetworkIntegration(config.backend, config.devices.device_id)
        self.command_executor = DeviceCommandExecutor(self.devices)
        self.scenarios = ScenarioController(config, self.simulation, self.devices, self.network)
        self.developer = DeveloperControls(config, self.simulation, self.devices)
        self.demo = AutomaticDemoController(config.demo)
        self.backend_online = False
        self.backend_message: str | None = None
        self.forecast: dict[str, Any] | None = None
        self.last_telemetry_at: str | None = None
        self._next_telemetry_at = time.monotonic()
        self._last_demo_status = self.demo.status
        self._actions: queue.Queue[tuple[str, dict[str, Any], Future[dict[str, Any]]]] = queue.Queue()
        self._state_lock = threading.RLock()
        self._revision = 0
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None
        self._closed = False

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self._closed:
            raise RuntimeError("simulation coordinator is closed")
        if self.running:
            return
        self.network.start()
        self._started_network = True
        self._stopping.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="aircheck-headless-simulation",
            daemon=True,
        )
        self._thread.start()
        LOGGER.info("Headless simulation started for device %s", self.config.devices.device_id)

    def close(self, *, close_network: bool | None = None) -> None:
        if self._closed:
            return
        self._closed = True
        self._stopping.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            if self._thread.is_alive():
                LOGGER.error("simulation thread did not stop within two seconds")
        if close_network is None:
            close_network = self._owns_network or self._started_network
        if close_network:
            self.network.close()
        while True:
            try:
                _, _, future = self._actions.get_nowait()
            except queue.Empty:
                break
            if not future.done():
                future.set_exception(RuntimeError("simulation coordinator is shutting down"))
        LOGGER.info("Headless simulation stopped")

    def dispatch(self, action: str, payload: dict[str, Any]) -> Future[dict[str, Any]]:
        if self._closed or not self.running:
            raise RuntimeError("simulation coordinator is not running")
        future: Future[dict[str, Any]] = Future()
        self._actions.put((action, payload, future))
        return future

    def execute_local(self, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """Execute a presentation-host action on its existing simulation thread."""
        with self._state_lock:
            return self._execute_action(action, payload or {})

    def snapshot(self) -> tuple[int, dict[str, Any]]:
        with self._state_lock:
            state = self.simulation.state
            sensors: list[dict[str, Any]] = []
            for sensor in state.sensors:
                readings: dict[str, float | None] = {}
                for measure in sensor.measurements:
                    try:
                        readings[measure] = read_sensor_value(state, sensor.zone, measure)
                    except SensorReadingUnavailable:
                        readings[measure] = None
                sensors.append(
                    {
                        "id": sensor.sensor_id,
                        "model": sensor.model,
                        "zone": sensor.zone,
                        "interface": sensor.interface,
                        "measurements": list(sensor.measurements),
                        "online": sensor.online,
                        "readings": readings,
                    }
                )
            window = state.window
            intake = state.ventilation.intake
            exhaust = state.ventilation.exhaust
            forecast = self.forecast
            demo = self._last_demo_status
            result = {
                "schema_version": 1,
                "revision": self._revision,
                "device_id": state.controller.device_id,
                "timestamp": state.simulated_at.isoformat().replace("+00:00", "Z"),
                "simulation": {
                    "elapsed_seconds": state.elapsed_seconds,
                    "speed": state.simulation_speed,
                    "fixed_step_seconds": state.fixed_step_seconds,
                    "room_volume_m3": state.room_volume_m3,
                    "occupancy": state.environment.occupancy,
                    "scenario": self.scenarios.active_scenario,
                    "scenarios": [
                        {"id": preset.scenario_id, "title": preset.title}
                        for preset in self.scenarios.scenarios
                    ],
                    "developer_values": self.developer.values(),
                    "developer_parameters": {
                        name: {
                            "minimum": parameter.minimum,
                            "maximum": parameter.maximum,
                            "step": parameter.step,
                            "integral": parameter.integral,
                        }
                        for name, parameter in self.config.demo.developer_parameters.items()
                    },
                    "supported_speeds": [0.0, *self.simulation.supported_speeds],
                    "room_dimensions": {
                        "width_m": self.config.scene.room_width_m,
                        "depth_m": self.config.scene.room_depth_m,
                        "height_m": self.config.scene.room_height_m,
                        "wall_thickness_m": self.config.scene.wall_thickness_m,
                        "window_width_m": self.config.scene.window_width_m,
                        "window_height_m": self.config.scene.window_height_m,
                        "window_sill_height_m": self.config.scene.window_sill_height_m,
                        "window_open_angle_degrees": self.config.scene.window_open_angle_degrees,
                        "outdoor_depth_m": self.config.scene.outdoor_depth_m,
                    },
                    "layout": asdict(EquipmentLayout.from_config(self.config.scene)),
                    "mount_dimensions": {
                        "control_cabinet_width_m": CONTROL_CABINET_WIDTH_M,
                        "control_cabinet_height_m": CONTROL_CABINET_HEIGHT_M,
                        "indoor_panel_width_m": INDOOR_MOUNT_PANEL_WIDTH_M,
                        "indoor_panel_height_m": INDOOR_MOUNT_PANEL_HEIGHT_M,
                    },
                    "camera": {
                        "start_position": list(self.config.camera.start_position),
                        "start_target": list(self.config.camera.start_target),
                        "move_speed_m_s": self.config.camera.move_speed_m_s,
                        "fast_move_multiplier": self.config.camera.fast_move_multiplier,
                        "mouse_sensitivity": self.config.camera.mouse_sensitivity,
                        "wheel_step_m": self.config.camera.wheel_step_m,
                        "transition_seconds": self.config.camera.transition_seconds,
                        "min_pitch_degrees": self.config.camera.min_pitch_degrees,
                        "max_pitch_degrees": self.config.camera.max_pitch_degrees,
                        "field_of_view_degrees": self.config.camera.field_of_view_degrees,
                        "near_plane_m": self.config.camera.near_plane_m,
                        "far_plane_m": self.config.camera.far_plane_m,
                        "focus_distance_min_m": self.config.camera.focus_distance_min_m,
                    },
                },
                "indoor": self._air_mapping(state.indoor),
                "outdoor": self._air_mapping(state.outdoor),
                "sensors": sensors,
                "window": {
                    "target_position_percent": window.target_position_percent,
                    "actual_position_percent": window.actual_position_percent,
                    "motor_state": window.motor_state.value,
                    "reed_switch": window.reed_switch,
                    "open_limit_switch": window.open_limit_switch,
                    "close_limit_switch": window.close_limit_switch,
                },
                "ventilation": {
                    "intake": self._fan_mapping(intake),
                    "exhaust": self._fan_mapping(exhaust),
                    "filter_enabled": state.ventilation.filter_enabled,
                    "filter_efficiency": state.ventilation.filter_efficiency,
                },
                "airflow": asdict(state.airflow),
                "energy": asdict(state.energy),
                "backend": {
                    "online": self.backend_online,
                    "message": self.backend_message,
                    "last_telemetry_at": self.last_telemetry_at,
                    "pending_commands": self.command_executor.pending_count,
                    "forecast": forecast,
                },
                "demo": asdict(demo),
            }
            return self._revision, result

    @staticmethod
    def _air_mapping(air: Any) -> dict[str, float]:
        return {
            "co2_ppm": air.co2_ppm,
            "pm25_ug_m3": air.pm25_ug_m3,
            "temperature_c": air.temperature_c,
            "humidity_percent": air.humidity_percent,
        }

    @staticmethod
    def _fan_mapping(fan: Any) -> dict[str, float | bool]:
        return {
            "enabled": fan.enabled,
            "rpm": fan.rpm,
            "airflow_m3_h": fan.airflow_m3_h,
            "nominal_rpm": fan.nominal_rpm,
            "nominal_airflow_m3_h": fan.nominal_airflow_m3_h,
            "rated_power_w": fan.rated_power_w,
        }

    def tick(self, real_delta_seconds: float) -> None:
        if not math.isfinite(real_delta_seconds) or real_delta_seconds < 0:
            real_delta_seconds = 0.0
        with self._state_lock:
            self._run_actions()
            self._drain_network_events()
            self.simulation.advance(real_delta_seconds)
            completed_ids = self.command_executor.update()
            self.demo.command_applied(completed_ids)
            for command in self.command_executor.active_commands:
                self.demo.command_started(command.command_id)
            now = datetime.now(timezone.utc)
            if completed_ids:
                LOGGER.info("Device command completed from actual state: ids=%s", completed_ids)
                self.network.acknowledge(
                    ControlStateReport.from_state(
                        self.network.device_id,
                        now,
                        self.devices.simulation_state,
                        completed_ids,
                    )
                )
            self.network.publish_actual_state(
                ControlStateReport.from_state(self.network.device_id, now, self.devices.simulation_state)
            )
            monotonic_now = time.monotonic()
            if monotonic_now >= self._next_telemetry_at:
                try:
                    self.network.publish_telemetry(MeasurementPayload.from_state(self.simulation.state, now))
                except (SensorReadingUnavailable, ValueError) as exc:
                    LOGGER.info("Virtual sensor telemetry withheld: %s", exc)
                self._next_telemetry_at = monotonic_now + self.network.config.telemetry_interval_seconds
            self._last_demo_status = self.demo.update(self.simulation.state, self.backend_online)
            self._revision += 1

    def _run_actions(self) -> None:
        while True:
            try:
                action, payload, future = self._actions.get_nowait()
            except queue.Empty:
                return
            if future.cancelled():
                continue
            try:
                result = self._execute_action(action, payload)
            except Exception as exc:
                future.set_exception(exc)
            else:
                future.set_result(result)

    def _execute_action(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        if action == "scenario":
            scenario_id = payload.get("scenario_id")
            if not isinstance(scenario_id, str):
                raise ValueError("scenario_id is required")
            self.demo.stop()
            preset = self.scenarios.apply(scenario_id)
            return {"scenario": preset.scenario_id, "title": preset.title}
        if action == "demo_start":
            self.scenarios.prepare_automatic_demo()
            self.demo.start(self.simulation.state)
            return {"active": True}
        if action == "demo_stop":
            self.demo.stop()
            return {"active": False}
        if action == "pause":
            self.simulation.toggle_pause()
            return {"speed": self.simulation.state.simulation_speed}
        if action == "window_open":
            self.devices.request_window_open()
            return {"target_position_percent": self.devices.simulation_state.window.target_position_percent}
        if action == "window_close":
            self.devices.request_window_close()
            return {"target_position_percent": self.devices.simulation_state.window.target_position_percent}
        if action == "intake_toggle":
            self.devices.toggle_intake()
            return {"enabled": self.devices.simulation_state.ventilation.intake.enabled}
        if action == "exhaust_toggle":
            self.devices.toggle_exhaust()
            return {"enabled": self.devices.simulation_state.ventilation.exhaust.enabled}
        if action == "filter_toggle":
            self.devices.toggle_filter()
            return {"enabled": self.devices.simulation_state.ventilation.filter_enabled}
        if action == "speed_step":
            direction = payload.get("direction")
            if type(direction) is not int:
                raise ValueError("direction must be -1 or 1")
            return {"speed": self.developer.step_simulation_speed(direction)}
        if action == "debug_adjust":
            key, direction = payload.get("key"), payload.get("direction")
            if not isinstance(key, str) or type(direction) is not int:
                raise ValueError("debug adjustment requires a key and direction")
            return {"key": key, "value": self.developer.adjust(key, direction)}
        if action == "speed":
            speed = payload.get("speed")
            if isinstance(speed, bool) or not isinstance(speed, (int, float)):
                raise ValueError("speed must be a number")
            self.simulation.set_speed(float(speed))
            return {"speed": self.simulation.state.simulation_speed}
        if action == "debug_set":
            key, value = payload.get("key"), payload.get("value")
            if not isinstance(key, str) or isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("debug action requires a key and numeric value")
            actual = self.developer.set_value(key, float(value))
            return {"key": key, "value": actual}
        raise ValueError(f"unsupported simulator action: {action}")

    def _drain_network_events(self) -> None:
        state = self.devices.simulation_state
        for event in self.network.drain_events():
            if isinstance(event, CommandReceived):
                self.command_executor.enqueue(event.command)
                self.demo.command_received(event.command.command_id)
            elif isinstance(event, AcknowledgementAccepted):
                self.command_executor.acknowledgement_accepted(event.command_ids)
                self.demo.acknowledgement_accepted(event.command_ids)
            elif isinstance(event, BackendStatusUpdate):
                self.backend_online = event.online
                self.backend_message = event.message
                state.controller.online = event.online
                state.controller.last_seen_at = event.last_seen_at
                if event.forecast is not None:
                    self.forecast = self._forecast_mapping(event.forecast)
            elif isinstance(event, TelemetryAccepted):
                self.last_telemetry_at = event.accepted_at
                if event.forecast is not None:
                    self.forecast = self._forecast_mapping(event.forecast)
                self.demo.forecast_received(event.forecast)

    @staticmethod
    def _forecast_mapping(forecast: Any) -> dict[str, Any]:
        return {
            "predicted_co2_15min": forecast.predicted_co2_15min,
            "target_time": forecast.target_time,
            "model_name": forecast.model_name,
            "model_version": forecast.model_version,
        }

    def _run(self) -> None:
        step = self.config.physics.fixed_step_seconds
        deadline = time.monotonic()
        while not self._stopping.is_set():
            delay = deadline - time.monotonic()
            if delay > 0:
                self._stopping.wait(delay)
                continue
            self.tick(step)
            deadline += step
            now = time.monotonic()
            if now - deadline > step * 4:
                deadline = now + step
