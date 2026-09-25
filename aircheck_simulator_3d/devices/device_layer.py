from __future__ import annotations

from dataclasses import replace

from aircheck_simulator_3d.app.config import DeviceConfig
from aircheck_simulator_3d.devices.models import FanState, VentilationState
from aircheck_simulator_3d.devices.presentation_state import DevicePresentationState
from aircheck_simulator_3d.devices.window_actuator import WindowActuator
from aircheck_simulator_3d.simulation.state import SimulationState


class DeviceLayer:
    """Owns virtual equipment state and exposes read-only presentation snapshots."""

    def __init__(self, state: SimulationState, config: DeviceConfig) -> None:
        self._state = state
        self._window = WindowActuator(
            state.window,
            travel_seconds=config.window_travel_seconds,
            reed_open_threshold_percent=config.window_reed_open_threshold_percent,
        )
        self._state.window = self._window.state

    @property
    def simulation_state(self) -> SimulationState:
        return self._state

    @property
    def presentation_state(self) -> DevicePresentationState:
        return DevicePresentationState.from_devices(self._state.window, self._state.ventilation)

    def request_window_open(self) -> None:
        self._state.window = self._window.open()

    def request_window_close(self) -> None:
        self._state.window = self._window.close()

    def set_intake_enabled(self, enabled: bool) -> None:
        self._state.ventilation = replace(
            self._state.ventilation,
            intake=self._fan_with_enabled(self._state.ventilation.intake, enabled),
        )

    def toggle_intake(self) -> None:
        self.set_intake_enabled(not self._state.ventilation.intake.enabled)

    def set_exhaust_enabled(self, enabled: bool) -> None:
        self._state.ventilation = replace(
            self._state.ventilation,
            exhaust=self._fan_with_enabled(self._state.ventilation.exhaust, enabled),
        )

    def toggle_exhaust(self) -> None:
        self.set_exhaust_enabled(not self._state.ventilation.exhaust.enabled)

    def advance(self, delta_seconds: float) -> None:
        self._state.window = self._window.advance(delta_seconds)

    @staticmethod
    def _fan_with_enabled(state: FanState, enabled: bool) -> FanState:
        return replace(state, enabled=enabled, rpm=state.nominal_rpm if enabled else 0.0)
