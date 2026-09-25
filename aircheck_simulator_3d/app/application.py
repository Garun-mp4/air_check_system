from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Protocol

from aircheck_simulator_3d.app.config import AppConfig, CameraConfig, GraphicsConfig, SceneConfig
from aircheck_simulator_3d.app.lifecycle import Lifecycle
from aircheck_simulator_3d.app.runtime import ApplicationRuntime
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.devices.models import (
    FanState,
    SensorDeviceState,
    VentilationState,
    VirtualEsp32State,
    WindowDeviceState,
    WindowMotorState,
)
from aircheck_simulator_3d.networking.workers import NetworkIntegration
from aircheck_simulator_3d.scene.window import PandaWindow
from aircheck_simulator_3d.simulation.state import (
    AirflowState,
    AirQualityState,
    EnergyState,
    EnvironmentState,
    SimulationState,
)
from aircheck_simulator_3d.simulation.engine import SimulationEngine

LOGGER = logging.getLogger("aircheck.application")


class WindowView(Protocol):
    def run(self, smoke_test_seconds: float | None = None) -> None: ...

    def close(self) -> None: ...


class Application:
    def __init__(
        self,
        config: AppConfig,
        window_factory: Callable[[GraphicsConfig], WindowView] | None = None,
    ) -> None:
        self.config = config
        self._window_factory = window_factory
        self.state = self._create_initial_state()
        self.device_layer = DeviceLayer(self.state, self.config.devices)
        self.simulation_engine = SimulationEngine(
            self.state,
            self.device_layer,
            self.config.physics,
            self.config.scene,
        )

    def _create_initial_state(self) -> SimulationState:
        room = self.config.room
        devices = self.config.devices
        position = devices.initial_window_position_percent
        window = WindowDeviceState(
            target_position_percent=position,
            actual_position_percent=position,
            motor_state=WindowMotorState.STOPPED,
            reed_switch=position >= devices.window_reed_open_threshold_percent,
            open_limit_switch=position >= 100,
            close_limit_switch=position <= 0,
        )
        ventilation = VentilationState(
            intake=FanState(
                enabled=False,
                rpm=0,
                airflow_m3_h=0,
                nominal_rpm=devices.intake_nominal_rpm,
                nominal_airflow_m3_h=devices.intake_airflow_m3_h,
                rated_power_w=devices.intake_power_w,
                efficiency=devices.intake_efficiency,
            ),
            exhaust=FanState(
                enabled=False,
                rpm=0,
                airflow_m3_h=0,
                nominal_rpm=devices.exhaust_nominal_rpm,
                nominal_airflow_m3_h=devices.exhaust_airflow_m3_h,
                rated_power_w=devices.exhaust_power_w,
                efficiency=devices.exhaust_efficiency,
            ),
            filter_efficiency=devices.filter_efficiency,
            filter_enabled=devices.filter_enabled,
        )
        indoor = room.initial_indoor
        outdoor = room.initial_outdoor
        return SimulationState(
            simulated_at=datetime.now(timezone.utc),
            elapsed_seconds=0,
            simulation_speed=room.simulation_speed,
            fixed_step_seconds=self.config.physics.fixed_step_seconds,
            room_volume_m3=room.volume_m3,
            indoor=AirQualityState(
                indoor.co2_ppm, indoor.pm25_ug_m3, indoor.temperature_c, indoor.humidity_percent
            ),
            outdoor=AirQualityState(
                outdoor.co2_ppm, outdoor.pm25_ug_m3, outdoor.temperature_c, outdoor.humidity_percent
            ),
            window=window,
            ventilation=ventilation,
            controller=VirtualEsp32State(device_id=devices.device_id),
            sensors=tuple(
                SensorDeviceState(
                    sensor_id=sensor.sensor_id,
                    model=sensor.model,
                    zone=sensor.zone,
                    interface=sensor.interface,
                    measurements=sensor.measurements,
                )
                for sensor in devices.sensors
            ),
            environment=EnvironmentState(
                occupancy=room.occupancy,
                co2_generation_l_min_per_person=room.co2_generation_l_min_per_person,
                pm25_generation_ug_min=room.pm25_generation_ug_min,
                infiltration_ach=room.infiltration_ach,
                weather=room.weather,
                wind_speed_m_s=room.wind_speed_m_s,
                wind_direction_degrees=room.wind_direction_degrees,
            ),
            energy=EnergyState(),
            airflow=AirflowState(),
        )

    def run(self, smoke_test_seconds: float | None = None) -> None:
        LOGGER.info("Opening Panda3D window for device %s", self.config.devices.device_id)
        lifecycle = Lifecycle()
        try:
            if self._window_factory is None:
                network = NetworkIntegration(self.config.backend, self.config.devices.device_id)
                lifecycle.add_cleanup(network.close)
                network.start()
                view = PandaWindow(
                    self.config,
                    self.device_layer,
                    self.simulation_engine,
                    network,
                )
            else:
                view = self._window_factory(self.config.graphics)
            lifecycle.add_cleanup(view.close)
            view.run(smoke_test_seconds=smoke_test_seconds)
        finally:
            lifecycle.close()
            LOGGER.info("AirCheck 3D Simulator stopped")
