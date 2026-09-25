from __future__ import annotations

import math
from datetime import timedelta

from aircheck_simulator_3d.simulation.state import SimulationState


class SimulationClock:
    """Advances simulation time in fixed steps, independently of render frame rate."""

    def __init__(self, state: SimulationState, max_substeps_per_frame: int) -> None:
        if max_substeps_per_frame < 1:
            raise ValueError("max_substeps_per_frame must be positive")
        self.state = state
        self._max_substeps_per_frame = max_substeps_per_frame
        self._accumulated_real_seconds = 0.0

    def advance(self, real_delta_seconds: float) -> int:
        if not math.isfinite(real_delta_seconds) or real_delta_seconds < 0:
            raise ValueError("real_delta_seconds must be finite and non-negative")
        if not math.isfinite(self.state.simulation_speed) or self.state.simulation_speed < 0:
            raise ValueError("simulation_speed must be finite and non-negative")
        if self.state.simulation_speed == 0:
            return 0
        self._accumulated_real_seconds += real_delta_seconds * self.state.simulation_speed
        step_seconds = self.state.fixed_step_seconds
        elapsed_steps = 0
        while (
            self._accumulated_real_seconds + step_seconds * 1e-12 >= step_seconds
            and elapsed_steps < self._max_substeps_per_frame
        ):
            self._accumulated_real_seconds = max(
                0.0, self._accumulated_real_seconds - step_seconds
            )
            self.state.elapsed_seconds += step_seconds
            self.state.simulated_at += timedelta(seconds=step_seconds)
            elapsed_steps += 1
        return elapsed_steps
