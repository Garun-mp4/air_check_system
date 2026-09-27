from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.tests.support import SimulationHarness, new_simulation


CONFIG_DIR = Path(__file__).parents[1] / "config"
SIMULATED_INTERVAL_SECONDS = 10.0


def configured_physics_app() -> SimulationHarness:
    app = new_simulation(load_config(CONFIG_DIR, {}))
    state = app.state
    state.simulated_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    state.indoor.co2_ppm = 1200.0
    state.indoor.pm25_ug_m3 = 4.0
    state.indoor.temperature_c = 24.0
    state.indoor.humidity_percent = 35.0
    state.outdoor.co2_ppm = 420.0
    state.outdoor.pm25_ug_m3 = 80.0
    state.outdoor.temperature_c = 6.0
    state.outdoor.humidity_percent = 75.0
    state.environment.occupancy = 2
    state.environment.infiltration_ach = 0.35
    app.device_layer.set_intake_enabled(True)
    app.device_layer.set_exhaust_enabled(True)
    return app


def advance_interval(app: SimulationHarness, speed: float, frame_count: int) -> int:
    app.simulation_engine.set_speed(speed)
    real_interval = SIMULATED_INTERVAL_SECONDS / speed
    steps = 0
    for _ in range(frame_count):
        steps += app.simulation_engine.advance(real_interval / frame_count)
    return steps


def physical_snapshot(app: SimulationHarness) -> tuple[float, ...]:
    state = app.state
    return (
        state.indoor.co2_ppm,
        state.indoor.pm25_ug_m3,
        state.indoor.temperature_c,
        state.indoor.humidity_percent,
        state.airflow.infiltration_m3_h,
        state.airflow.intake_m3_h,
        state.airflow.exhaust_m3_h,
        state.airflow.total_effective_m3_h,
        state.airflow.air_changes_per_hour,
        state.energy.fan_energy_wh,
        state.energy.estimated_ventilation_heat_loss_wh,
        state.energy.total_relative_energy,
    )


@pytest.mark.parametrize("speed", (1.0, 2.0, 5.0, 10.0, 30.0, 60.0))
@pytest.mark.parametrize("frame_count", (1, 10, 100))
def test_fixed_step_physics_is_reproducible_across_speeds_and_frame_partitions(
    speed: float, frame_count: int
) -> None:
    baseline = configured_physics_app()
    actual = configured_physics_app()

    baseline_steps = advance_interval(baseline, 1.0, 1)
    actual_steps = advance_interval(actual, speed, frame_count)

    expected_steps = round(SIMULATED_INTERVAL_SECONDS / actual.state.fixed_step_seconds)
    assert baseline_steps == actual_steps == expected_steps
    assert baseline.state.elapsed_seconds == pytest.approx(SIMULATED_INTERVAL_SECONDS)
    assert actual.state.elapsed_seconds == pytest.approx(SIMULATED_INTERVAL_SECONDS)
    assert actual.state.simulated_at == baseline.state.simulated_at
    assert physical_snapshot(actual) == pytest.approx(physical_snapshot(baseline), rel=1e-10, abs=1e-12)
    assert all(
        value >= 0
        for value in (
            actual.state.indoor.co2_ppm,
            actual.state.indoor.pm25_ug_m3,
            actual.state.airflow.total_effective_m3_h,
            actual.state.energy.fan_energy_wh,
            actual.state.energy.estimated_ventilation_heat_loss_wh,
            actual.state.energy.total_relative_energy,
        )
    )


def test_pause_freezes_physics_without_losing_fractional_fixed_step_time() -> None:
    app = configured_physics_app()
    app.simulation_engine.set_speed(30.0)
    before = physical_snapshot(app)
    before_elapsed = app.state.elapsed_seconds
    before_time = app.state.simulated_at

    assert app.simulation_engine.advance(0.05 / 30.0) == 0
    app.simulation_engine.toggle_pause()
    assert app.state.simulation_speed == 0.0
    assert app.simulation_engine.advance(5.0) == 0
    assert physical_snapshot(app) == before
    assert app.state.elapsed_seconds == before_elapsed
    assert app.state.simulated_at == before_time

    app.simulation_engine.toggle_pause()
    assert app.state.simulation_speed == 30.0
    assert app.simulation_engine.advance(0.05 / 30.0) == 1
    assert app.state.elapsed_seconds == pytest.approx(app.state.fixed_step_seconds)
