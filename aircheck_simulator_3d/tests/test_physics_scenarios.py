from __future__ import annotations

import math
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.simulation.room_model import RoomModel
from aircheck_simulator_3d.tests.support import SimulationHarness, new_simulation


CONFIG_DIR = Path(__file__).parents[1] / "config"


def new_app() -> SimulationHarness:
    return new_simulation(load_config(CONFIG_DIR, {}))


def run_simulated_seconds(app: SimulationHarness, seconds: float) -> None:
    """Advance through engine ticks while respecting its per-frame catch-up cap."""
    state = app.state
    total_ticks = round(seconds / state.fixed_step_seconds)
    remaining_ticks = total_ticks
    while remaining_ticks:
        ticks = min(remaining_ticks, app.config.physics.max_substeps_per_frame)
        real_seconds = ticks * state.fixed_step_seconds / state.simulation_speed
        assert app.simulation_engine.advance(real_seconds) == ticks
        remaining_ticks -= ticks


def test_closed_room_co2_generation_scales_with_occupancy() -> None:
    one_person = new_app()
    two_people = new_app()
    for app, occupancy in ((one_person, 1), (two_people, 2)):
        app.state.environment.occupancy = occupancy
        app.state.environment.infiltration_ach = 0.0
        app.state.environment.wind_speed_m_s = 0.0
        assert app.state.airflow.total_effective_m3_h == 0.0

    initial_co2 = one_person.state.indoor.co2_ppm
    run_simulated_seconds(one_person, 10 * 60)
    run_simulated_seconds(two_people, 10 * 60)

    one_person_increase = one_person.state.indoor.co2_ppm - initial_co2
    two_people_increase = two_people.state.indoor.co2_ppm - initial_co2
    assert one_person_increase > 0
    assert two_people_increase == pytest.approx(2 * one_person_increase)
    assert math.isfinite(two_people.state.indoor.co2_ppm)


def test_pm25_deposition_lowers_concentration_without_sources_or_airflow() -> None:
    app = new_app()
    app.state.indoor.pm25_ug_m3 = 10.0
    app.state.environment.pm25_generation_ug_min = 0.0
    app.state.environment.infiltration_ach = 0.0
    app.state.environment.occupancy = 0
    app.state.environment.wind_speed_m_s = 0.0

    run_simulated_seconds(app, 60 * 60)

    assert 0 < app.state.indoor.pm25_ug_m3 < 10.0
    assert math.isfinite(app.state.indoor.pm25_ug_m3)


def test_filter_does_not_change_particle_exchange_through_an_open_window() -> None:
    filtered = new_app()
    unfiltered = new_app()
    for app in (filtered, unfiltered):
        app.state.indoor.pm25_ug_m3 = 3.0
        app.state.outdoor.pm25_ug_m3 = 100.0
        app.state.environment.infiltration_ach = 0.0
        app.state.environment.wind_speed_m_s = 2.0
        app.state.window.actual_position_percent = 100.0
    unfiltered.device_layer.set_filter_enabled(False)

    for app in (filtered, unfiltered):
        model = RoomModel(app.config.physics, app.config.scene)
        for _ in range(round((10 * 60) / app.state.fixed_step_seconds)):
            model.step(app.state, app.state.fixed_step_seconds)

    assert filtered.state.airflow.window_m3_h > 0
    assert filtered.state.ventilation.intake.airflow_m3_h == 0
    assert filtered.state.indoor.pm25_ug_m3 == pytest.approx(
        unfiltered.state.indoor.pm25_ug_m3, abs=1e-12
    )


def test_exhaust_makeup_flow_uses_outdoor_air_and_unfiltered_particles() -> None:
    exhaust_only = new_app()
    balanced = new_app()
    for app in (exhaust_only, balanced):
        app.state.indoor.pm25_ug_m3 = 0.0
        app.state.outdoor.pm25_ug_m3 = 100.0
        app.state.environment.occupancy = 0
        app.state.environment.infiltration_ach = 0.0
        app.state.environment.wind_speed_m_s = 0.0
        app.device_layer.set_filter_enabled(True)
        app.device_layer.set_exhaust_enabled(True)
    exhaust_only.device_layer.set_exhaust_airflow(60.0)
    balanced.device_layer.set_intake_airflow(60.0)
    balanced.device_layer.set_exhaust_airflow(60.0)

    run_simulated_seconds(exhaust_only, 10 * 60)
    run_simulated_seconds(balanced, 10 * 60)

    assert exhaust_only.state.airflow.exhaust_m3_h > exhaust_only.state.airflow.intake_m3_h
    assert exhaust_only.state.airflow.total_effective_m3_h == pytest.approx(60.0)
    assert balanced.state.airflow.total_effective_m3_h == pytest.approx(60.0)
    assert exhaust_only.state.indoor.pm25_ug_m3 > balanced.state.indoor.pm25_ug_m3
    assert all(
        math.isfinite(value) and value >= 0
        for value in (
            exhaust_only.state.airflow.total_effective_m3_h,
            exhaust_only.state.airflow.air_changes_per_hour,
            exhaust_only.state.indoor.pm25_ug_m3,
            exhaust_only.state.energy.total_relative_energy,
        )
    )


def test_warm_outdoor_air_heats_a_cooler_room_under_air_exchange() -> None:
    app = new_app()
    app.state.indoor.temperature_c = 15.0
    app.state.outdoor.temperature_c = 30.0
    app.state.environment.occupancy = 0
    app.state.environment.infiltration_ach = 0.8

    run_simulated_seconds(app, 60 * 60)

    assert 15.0 < app.state.indoor.temperature_c < 30.0
    assert app.config.physics.minimum_room_temperature_c <= app.state.indoor.temperature_c
    assert app.state.indoor.temperature_c <= app.config.physics.maximum_room_temperature_c
    assert math.isfinite(app.state.indoor.temperature_c)


def test_humidity_exchange_moves_relative_humidity_toward_outdoor_moisture() -> None:
    app = new_app()
    app.state.indoor.temperature_c = 20.0
    app.state.outdoor.temperature_c = 20.0
    app.state.indoor.humidity_percent = 20.0
    app.state.outdoor.humidity_percent = 80.0
    app.state.environment.occupancy = 0
    app.state.environment.infiltration_ach = 1.0

    run_simulated_seconds(app, 30 * 60)

    assert 20.0 < app.state.indoor.humidity_percent < 80.0
    assert app.config.physics.minimum_humidity_percent <= app.state.indoor.humidity_percent
    assert app.state.indoor.humidity_percent <= app.config.physics.maximum_humidity_percent
    assert math.isfinite(app.state.indoor.humidity_percent)
