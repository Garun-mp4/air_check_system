from datetime import datetime, timezone
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.simulation.clock import SimulationClock


CONFIG_DIR = Path(__file__).parents[1] / "config"


def test_clock_advances_fixed_simulation_time_independent_of_frame_rate() -> None:
    state = Application(load_config(CONFIG_DIR, {})).state
    state.simulated_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    state.fixed_step_seconds = 1.0
    state.simulation_speed = 2
    clock = SimulationClock(state, max_substeps_per_frame=5)

    assert clock.advance(0.4) == 0
    assert clock.advance(0.1) == 1
    assert state.elapsed_seconds == 1
    assert state.simulated_at == datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc)


def test_clock_limits_substeps_and_carries_remaining_time() -> None:
    state = Application(load_config(CONFIG_DIR, {})).state
    state.fixed_step_seconds = 1.0
    clock = SimulationClock(state, max_substeps_per_frame=2)

    assert clock.advance(5) == 2
    assert clock.advance(0) == 2
    assert clock.advance(0) == 1
    assert state.elapsed_seconds == 5


@pytest.mark.parametrize("delta", [-1, float("nan"), float("inf")])
def test_clock_rejects_invalid_elapsed_time(delta: float) -> None:
    state = Application(load_config(CONFIG_DIR, {})).state

    with pytest.raises(ValueError, match="finite and non-negative"):
        SimulationClock(state, max_substeps_per_frame=1).advance(delta)


def test_clock_does_not_advance_while_paused_even_with_pending_fraction() -> None:
    state = Application(load_config(CONFIG_DIR, {})).state
    clock = SimulationClock(state, max_substeps_per_frame=5)

    assert clock.advance(0.05) == 0
    state.simulation_speed = 0
    assert clock.advance(10) == 0
    assert state.elapsed_seconds == 0

    state.simulation_speed = 1
    assert clock.advance(0.05) == 1
    assert state.elapsed_seconds == pytest.approx(state.fixed_step_seconds)
