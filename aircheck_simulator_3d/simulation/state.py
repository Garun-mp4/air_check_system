from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

from aircheck_simulator_3d.devices.models import (
    SensorDeviceState,
    VentilationState,
    VirtualEsp32State,
    WindowDeviceState,
)


@dataclass
class AirQualityState:
    co2_ppm: float
    pm25_ug_m3: float
    temperature_c: float
    humidity_percent: float

    def __post_init__(self) -> None:
        values = (self.co2_ppm, self.pm25_ug_m3, self.temperature_c, self.humidity_percent)
        if any(not math.isfinite(value) for value in values):
            raise ValueError("air readings must be finite")
        if self.co2_ppm <= 0 or self.pm25_ug_m3 < 0 or not 0 <= self.humidity_percent <= 100:
            raise ValueError("air readings are outside valid ranges")


@dataclass
class EnvironmentState:
    occupancy: int
    co2_generation_l_min: float
    pm25_generation_ug_min: float
    infiltration_ach: float
    weather: str
    wind_speed_m_s: float
    wind_direction_degrees: float


@dataclass
class EnergyState:
    fan_energy_wh: float = 0
    estimated_ventilation_heat_loss_wh: float = 0
    total_relative_energy: float = 0


@dataclass
class SimulationState:
    """Single source of truth for the simulated room, devices and elapsed time."""

    simulated_at: datetime
    elapsed_seconds: float
    simulation_speed: float
    fixed_step_seconds: float
    room_volume_m3: float
    indoor: AirQualityState
    outdoor: AirQualityState
    window: WindowDeviceState
    ventilation: VentilationState
    controller: VirtualEsp32State
    sensors: tuple[SensorDeviceState, ...]
    environment: EnvironmentState
    energy: EnergyState = field(default_factory=EnergyState)

    def __post_init__(self) -> None:
        if self.simulated_at.tzinfo is None:
            raise ValueError("simulated_at must include a timezone")
        time_and_room_values = (
            self.elapsed_seconds,
            self.simulation_speed,
            self.fixed_step_seconds,
            self.room_volume_m3,
        )
        if any(not math.isfinite(value) for value in time_and_room_values):
            raise ValueError("simulation time, speed and room volume must be finite")
        if (
            self.elapsed_seconds < 0
            or self.simulation_speed <= 0
            or self.fixed_step_seconds <= 0
            or self.room_volume_m3 <= 0
        ):
            raise ValueError("elapsed time, simulation speed or room volume is invalid")
