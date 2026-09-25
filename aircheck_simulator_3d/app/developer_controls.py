from __future__ import annotations

import math

from aircheck_simulator_3d.app.config import AppConfig
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.simulation.engine import SimulationEngine


class DeveloperControls:
    """Bounded manual controls that edit the active simulation/device state."""

    def __init__(self, config: AppConfig, simulation: SimulationEngine, devices: DeviceLayer) -> None:
        self._config = config
        self._simulation = simulation
        self._devices = devices

    def values(self) -> dict[str, float]:
        state = self._simulation.state
        return {
            "occupancy": float(state.environment.occupancy),
            "outdoor_co2_ppm": state.outdoor.co2_ppm,
            "outdoor_pm25_ug_m3": state.outdoor.pm25_ug_m3,
            "outdoor_temperature_c": state.outdoor.temperature_c,
            "outdoor_humidity_percent": state.outdoor.humidity_percent,
            "indoor_pm25_generation_ug_min": state.environment.pm25_generation_ug_min,
            "wind_speed_m_s": state.environment.wind_speed_m_s,
            "infiltration_ach": state.environment.infiltration_ach,
            "filter_efficiency": state.ventilation.filter_efficiency,
            "intake_airflow_m3_h": state.ventilation.intake.airflow_m3_h,
            "exhaust_airflow_m3_h": state.ventilation.exhaust.airflow_m3_h,
            "sensor_noise_percent": state.sensor_noise_percent,
        }

    def adjust(self, name: str, direction: int) -> float:
        if direction not in (-1, 1):
            raise ValueError("debug adjustment direction must be -1 or 1")
        parameter = self._config.demo.developer_parameters.get(name)
        if parameter is None:
            raise ValueError(f"unknown Developer Panel parameter: {name}")
        current = self.values()[name]
        value = min(parameter.maximum, max(parameter.minimum, current + direction * parameter.step))
        if parameter.integral:
            value = float(round(value))
        else:
            decimals = max(0, -int(math.floor(math.log10(parameter.step))) + 1) if parameter.step < 1 else 0
            value = round(value, decimals)
        state = self._simulation.state
        if name == "occupancy":
            state.environment.occupancy = int(value)
        elif name == "outdoor_co2_ppm":
            state.outdoor.co2_ppm = value
        elif name == "outdoor_pm25_ug_m3":
            state.outdoor.pm25_ug_m3 = value
        elif name == "outdoor_temperature_c":
            state.outdoor.temperature_c = value
        elif name == "outdoor_humidity_percent":
            state.outdoor.humidity_percent = value
        elif name == "indoor_pm25_generation_ug_min":
            state.environment.pm25_generation_ug_min = value
        elif name == "wind_speed_m_s":
            state.environment.wind_speed_m_s = value
        elif name == "infiltration_ach":
            state.environment.infiltration_ach = value
        elif name == "filter_efficiency":
            self._devices.set_filter_efficiency(value)
        elif name == "intake_airflow_m3_h":
            self._devices.set_intake_airflow(value)
        elif name == "exhaust_airflow_m3_h":
            self._devices.set_exhaust_airflow(value)
        elif name == "sensor_noise_percent":
            state.sensor_noise_percent = value
        return value

    def step_simulation_speed(self, direction: int) -> float:
        if direction not in (-1, 1):
            raise ValueError("simulation speed direction must be -1 or 1")
        speeds = (0.0, *self._simulation.supported_speeds)
        current = self._simulation.state.simulation_speed
        index = speeds.index(current)
        new_speed = speeds[(index + direction) % len(speeds)]
        self._simulation.set_speed(new_speed)
        return new_speed
