from __future__ import annotations

from dataclasses import replace

from aircheck_simulator_3d.app.config import AppConfig, ScenarioPreset
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.devices.models import SensorDeviceState
from aircheck_simulator_3d.networking.workers import NetworkIntegration
from aircheck_simulator_3d.simulation.engine import SimulationEngine
from aircheck_simulator_3d.simulation.state import AirQualityState, AirflowState, EnergyState


class ScenarioController:
    """Applies configured demo conditions to the simulator's canonical state."""

    def __init__(
        self,
        config: AppConfig,
        simulation: SimulationEngine,
        devices: DeviceLayer,
        network: NetworkIntegration | None,
    ) -> None:
        self._config = config
        self._simulation = simulation
        self._devices = devices
        self._network = network
        self.active_scenario = "Normal Room"

    @property
    def scenarios(self) -> tuple[ScenarioPreset, ...]:
        return self._config.demo.scenarios

    def apply(self, scenario_id: str) -> ScenarioPreset:
        preset = next((item for item in self.scenarios if item.scenario_id == scenario_id), None)
        if preset is None:
            raise ValueError(f"unknown demo scenario: {scenario_id}")

        state = self._simulation.state
        initial = self._config.room.initial_indoor
        state.indoor = AirQualityState(
            initial.co2_ppm,
            initial.pm25_ug_m3,
            initial.temperature_c,
            initial.humidity_percent,
        )
        state.outdoor = AirQualityState(
            preset.outdoor_co2_ppm,
            preset.outdoor_pm25_ug_m3,
            preset.outdoor_temperature_c,
            preset.outdoor_humidity_percent,
        )
        state.environment.occupancy = preset.occupancy
        state.environment.pm25_generation_ug_min = preset.indoor_pm25_generation_ug_min
        state.environment.wind_speed_m_s = preset.wind_speed_m_s
        state.environment.infiltration_ach = preset.infiltration_ach
        state.sensor_noise_percent = 0.0
        failed = set(preset.failed_sensor_ids)
        state.sensors = tuple(
            replace(sensor, online=sensor.sensor_id not in failed) for sensor in state.sensors
        )
        state.energy = EnergyState()
        state.airflow = AirflowState()
        self._devices.request_window_close()
        self._devices.set_intake_enabled(False)
        self._devices.set_exhaust_enabled(False)
        self._devices.set_filter_efficiency(preset.filter_efficiency)
        self._simulation.set_speed(preset.simulation_speed)
        if self._network is not None:
            self._network.set_demo_offline(preset.backend_offline)
        self.active_scenario = preset.title
        return preset

    def prepare_automatic_demo(self) -> None:
        self.apply("co2_buildup")
        self._simulation.state.environment.occupancy = self._config.demo.automatic_occupancy
        self._simulation.set_speed(self._config.demo.automatic_speed)
        if self._network is not None:
            self._network.set_demo_offline(False)
        self.active_scenario = "Automatic demo"
