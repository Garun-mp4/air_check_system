from __future__ import annotations

import math

from aircheck_simulator_3d.app.config import PhysicsConfig, SceneConfig
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.simulation.clock import SimulationClock
from aircheck_simulator_3d.simulation.room_model import RoomModel
from aircheck_simulator_3d.simulation.state import SimulationState


class SimulationEngine:
    """Coordinates fixed simulation ticks, device motion and the room model."""

    def __init__(
        self,
        state: SimulationState,
        devices: DeviceLayer,
        physics: PhysicsConfig,
        scene: SceneConfig,
    ) -> None:
        self.state = state
        self._devices = devices
        self._physics = physics
        self._clock = SimulationClock(state, physics.max_substeps_per_frame)
        self._room_model = RoomModel(physics, scene)
        self._resume_speed = state.simulation_speed or physics.simulation_speeds[0]

    @property
    def supported_speeds(self) -> tuple[float, ...]:
        return self._physics.simulation_speeds

    def set_speed(self, speed: float) -> None:
        if (
            not math.isfinite(speed)
            or speed < 0
            or (speed != 0 and speed not in self._physics.simulation_speeds)
        ):
            raise ValueError("simulation speed must be Pause or one of the configured speeds")
        self.state.simulation_speed = speed
        if speed > 0:
            self._resume_speed = speed

    def toggle_pause(self) -> None:
        if self.state.simulation_speed == 0:
            self.state.simulation_speed = self._resume_speed
        else:
            self._resume_speed = self.state.simulation_speed
            self.state.simulation_speed = 0.0

    def advance(self, real_delta_seconds: float) -> int:
        steps = self._clock.advance(real_delta_seconds)
        fixed_step = self.state.fixed_step_seconds
        for _ in range(steps):
            self._devices.advance(fixed_step)
            self._room_model.step(self.state, fixed_step)
        return steps
