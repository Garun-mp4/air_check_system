from __future__ import annotations

from dataclasses import dataclass

from aircheck_simulator_3d.devices.models import FanState, VentilationState, WindowDeviceState


@dataclass(frozen=True)
class WindowPresentationState:
    actual_position_percent: float
    motor_state: str
    reed_switch: bool
    open_limit_switch: bool
    close_limit_switch: bool

    @classmethod
    def from_device(cls, state: WindowDeviceState) -> WindowPresentationState:
        return cls(
            actual_position_percent=state.actual_position_percent,
            motor_state=state.motor_state.value,
            reed_switch=state.reed_switch,
            open_limit_switch=state.open_limit_switch,
            close_limit_switch=state.close_limit_switch,
        )


@dataclass(frozen=True)
class FanPresentationState:
    enabled: bool
    rpm: float

    @classmethod
    def from_device(cls, state: FanState) -> FanPresentationState:
        return cls(enabled=state.enabled, rpm=state.rpm)


@dataclass(frozen=True)
class DevicePresentationState:
    window: WindowPresentationState
    intake: FanPresentationState
    exhaust: FanPresentationState

    @classmethod
    def from_devices(
        cls, window: WindowDeviceState, ventilation: VentilationState
    ) -> DevicePresentationState:
        return cls(
            window=WindowPresentationState.from_device(window),
            intake=FanPresentationState.from_device(ventilation.intake),
            exhaust=FanPresentationState.from_device(ventilation.exhaust),
        )
