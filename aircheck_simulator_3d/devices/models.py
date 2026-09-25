from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum


class WindowMotorState(StrEnum):
    STOPPED = "stopped"
    OPENING = "opening"
    CLOSING = "closing"
    FAULT = "fault"


@dataclass
class WindowDeviceState:
    target_position_percent: float
    actual_position_percent: float
    motor_state: WindowMotorState
    reed_switch: bool
    open_limit_switch: bool
    close_limit_switch: bool

    def __post_init__(self) -> None:
        if (
            not math.isfinite(self.target_position_percent)
            or not math.isfinite(self.actual_position_percent)
            or not 0 <= self.target_position_percent <= 100
            or not 0 <= self.actual_position_percent <= 100
        ):
            raise ValueError("window positions must be between 0 and 100 percent")


@dataclass
class FanState:
    enabled: bool
    rpm: float
    airflow_m3_h: float
    nominal_rpm: float
    nominal_airflow_m3_h: float
    rated_power_w: float
    efficiency: float

    def __post_init__(self) -> None:
        values = (self.rpm, self.airflow_m3_h, self.nominal_rpm, self.nominal_airflow_m3_h, self.rated_power_w)
        if any(not math.isfinite(value) or value < 0 for value in values):
            raise ValueError("fan speed, airflow and rated values cannot be negative")
        if not math.isfinite(self.efficiency) or not 0 < self.efficiency <= 1:
            raise ValueError("fan efficiency must be in (0, 1]")


@dataclass
class VentilationState:
    intake: FanState
    exhaust: FanState
    filter_efficiency: float
    filter_enabled: bool = True

    def __post_init__(self) -> None:
        if not 0 <= self.filter_efficiency <= 1:
            raise ValueError("filter efficiency must be between 0 and 1")


@dataclass
class VirtualEsp32State:
    device_id: str
    online: bool = False
    last_seen_at: str | None = None

    def __post_init__(self) -> None:
        if not self.device_id.strip():
            raise ValueError("device_id must not be empty")


@dataclass(frozen=True)
class SensorDeviceState:
    sensor_id: str
    model: str
    zone: str
    interface: str
    measurements: tuple[str, ...]
    online: bool = True
