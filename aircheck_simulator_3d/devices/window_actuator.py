from __future__ import annotations

import math
from dataclasses import replace

from aircheck_simulator_3d.devices.models import WindowDeviceState, WindowMotorState


class WindowActuator:
    """Device-layer window motor and end-stop state machine."""

    def __init__(
        self,
        initial_state: WindowDeviceState,
        *,
        travel_seconds: float,
        reed_open_threshold_percent: float,
    ) -> None:
        if not math.isfinite(travel_seconds) or travel_seconds <= 0:
            raise ValueError("window travel time must be finite and positive")
        if not math.isfinite(reed_open_threshold_percent) or not 0 <= reed_open_threshold_percent <= 100:
            raise ValueError("reed threshold must be between 0 and 100 percent")
        self._travel_seconds = travel_seconds
        self._reed_threshold = reed_open_threshold_percent
        position = initial_state.actual_position_percent
        self._state = self._with_outputs(
            replace(initial_state, target_position_percent=position, motor_state=WindowMotorState.STOPPED)
        )

    @property
    def state(self) -> WindowDeviceState:
        return replace(self._state)

    def open(self) -> WindowDeviceState:
        return self._set_target(100.0)

    def close(self) -> WindowDeviceState:
        return self._set_target(0.0)

    def _set_target(self, target: float) -> WindowDeviceState:
        actual = self._state.actual_position_percent
        if math.isclose(actual, target, abs_tol=1e-9):
            motor = WindowMotorState.STOPPED
        else:
            motor = WindowMotorState.OPENING if target > actual else WindowMotorState.CLOSING
        self._state = self._with_outputs(
            replace(self._state, target_position_percent=target, motor_state=motor)
        )
        return self.state

    def advance(self, delta_seconds: float) -> WindowDeviceState:
        if not math.isfinite(delta_seconds) or delta_seconds < 0:
            raise ValueError("delta time must be finite and non-negative")
        state = self._state
        difference = state.target_position_percent - state.actual_position_percent
        if math.isclose(difference, 0.0, abs_tol=1e-9):
            actual = state.target_position_percent
            motor = WindowMotorState.STOPPED
        elif delta_seconds == 0:
            actual = state.actual_position_percent
            motor = WindowMotorState.OPENING if difference > 0 else WindowMotorState.CLOSING
        else:
            step = 100.0 * delta_seconds / self._travel_seconds
            actual = min(state.actual_position_percent + step, state.target_position_percent) if difference > 0 else max(
                state.actual_position_percent - step, state.target_position_percent
            )
            motor = WindowMotorState.STOPPED if math.isclose(actual, state.target_position_percent, abs_tol=1e-9) else (
                WindowMotorState.OPENING if difference > 0 else WindowMotorState.CLOSING
            )
            if motor is WindowMotorState.STOPPED:
                actual = state.target_position_percent
        self._state = self._with_outputs(
            replace(state, actual_position_percent=actual, motor_state=motor)
        )
        return self.state

    def _with_outputs(self, state: WindowDeviceState) -> WindowDeviceState:
        position = state.actual_position_percent
        return replace(
            state,
            reed_switch=position >= self._reed_threshold,
            open_limit_switch=position >= 100.0,
            close_limit_switch=position <= 0.0,
        )
