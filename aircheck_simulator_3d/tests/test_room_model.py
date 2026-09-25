from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.simulation.room_model import RoomModel


CONFIG_DIR = Path(__file__).parents[1] / "config"
FIXED_TIME = datetime(2026, 1, 1, tzinfo=timezone.utc)


def new_app() -> Application:
    app = Application(load_config(CONFIG_DIR, {}))
    app.state.simulated_at = FIXED_TIME
    return app


def run_simulated_seconds(app: Application, simulated_seconds: float) -> None:
    state = app.state
    tick_count = round(simulated_seconds / state.fixed_step_seconds)
    remaining_ticks = tick_count
    while remaining_ticks:
        ticks = min(remaining_ticks, app.config.physics.max_substeps_per_frame)
        real_seconds = ticks * state.fixed_step_seconds / state.simulation_speed
        assert app.simulation_engine.advance(real_seconds) == ticks
        remaining_ticks -= ticks


def test_co2_builds_with_people_in_a_closed_room() -> None:
    app = new_app()
    app.state.environment.occupancy = 2
    initial = app.state.indoor.co2_ppm

    run_simulated_seconds(app, 30 * 60)

    assert app.state.indoor.co2_ppm > initial
    assert app.state.airflow.window_m3_h == 0
    assert not app.state.ventilation.intake.enabled
    assert not app.state.ventilation.exhaust.enabled


def test_open_window_moves_co2_toward_clean_outdoor_air() -> None:
    app = new_app()
    app.state.indoor.co2_ppm = 1800.0
    app.state.outdoor.co2_ppm = 420.0
    app.state.environment.wind_speed_m_s = 2.0
    app.device_layer.request_window_open()

    run_simulated_seconds(app, 10 * 60)

    assert app.state.window.open_limit_switch
    assert app.state.airflow.window_m3_h > 0
    assert app.state.indoor.co2_ppm < 1800.0


def test_fans_increase_effective_air_changes_without_double_counting_balanced_flow() -> None:
    app = new_app()
    closed_air_changes = app.state.airflow.air_changes_per_hour
    app.device_layer.set_intake_enabled(True)
    app.device_layer.set_exhaust_enabled(True)

    run_simulated_seconds(app, app.state.fixed_step_seconds)

    assert app.state.airflow.total_effective_m3_h == pytest.approx(
        app.config.room.infiltration_ach * app.state.room_volume_m3
        + app.config.devices.intake_airflow_m3_h
    )
    assert app.state.airflow.air_changes_per_hour > closed_air_changes


def test_open_window_can_raise_pm25_when_outdoor_air_is_polluted() -> None:
    app = new_app()
    app.state.indoor.pm25_ug_m3 = 3.0
    app.state.outdoor.pm25_ug_m3 = 120.0
    app.state.environment.wind_speed_m_s = 3.0
    app.device_layer.request_window_open()

    run_simulated_seconds(app, 15 * 60)

    assert app.state.indoor.pm25_ug_m3 > 3.0


def test_filtered_intake_reduces_incoming_pm25() -> None:
    filtered = new_app()
    unfiltered = new_app()
    for app in (filtered, unfiltered):
        app.state.indoor.pm25_ug_m3 = 4.0
        app.state.outdoor.pm25_ug_m3 = 100.0
        app.device_layer.set_intake_enabled(True)
    unfiltered.device_layer.set_filter_enabled(False)

    run_simulated_seconds(filtered, 60 * 60)
    run_simulated_seconds(unfiltered, 60 * 60)

    assert filtered.state.indoor.pm25_ug_m3 < unfiltered.state.indoor.pm25_ug_m3
    assert filtered.state.indoor.pm25_ug_m3 < filtered.state.outdoor.pm25_ug_m3


def test_open_window_in_cold_weather_cools_room_and_increases_heat_loss_estimate() -> None:
    opened = new_app()
    closed = new_app()
    for app in (opened, closed):
        app.state.indoor.temperature_c = 23.0
        app.state.outdoor.temperature_c = 4.0
        app.state.environment.wind_speed_m_s = 1.0
    opened.device_layer.request_window_open()

    run_simulated_seconds(opened, 2 * 60 * 60)
    run_simulated_seconds(closed, 2 * 60 * 60)

    assert opened.state.indoor.temperature_c < 23.0
    assert opened.state.indoor.temperature_c < closed.state.indoor.temperature_c
    assert opened.state.energy.estimated_ventilation_heat_loss_wh > (
        closed.state.energy.estimated_ventilation_heat_loss_wh
    )


def test_energy_estimate_changes_with_fan_ventilation_mode() -> None:
    app = new_app()
    app.device_layer.set_intake_enabled(True)
    app.device_layer.set_exhaust_enabled(True)

    run_simulated_seconds(app, 60 * 60)

    assert app.state.energy.fan_energy_wh > 0
    assert app.state.energy.total_relative_energy == pytest.approx(
        app.state.energy.fan_energy_wh
        + app.state.energy.estimated_ventilation_heat_loss_wh
    )


def test_fan_rpm_and_efficiency_set_flow_and_electrical_energy() -> None:
    app = new_app()
    app.device_layer.set_intake_enabled(True)
    app.device_layer.set_intake_speed(app.config.devices.intake_nominal_rpm / 2)

    run_simulated_seconds(app, 60 * 60)

    assert app.state.ventilation.intake.rpm == app.config.devices.intake_nominal_rpm / 2
    assert app.state.airflow.intake_m3_h == pytest.approx(
        app.config.devices.intake_airflow_m3_h * 0.5
    )
    expected_electrical_power_w = (
        app.config.devices.intake_power_w
        * 0.5**app.config.physics.fan_power_speed_exponent
        / app.config.devices.intake_efficiency
    )
    assert app.state.energy.fan_energy_wh == pytest.approx(expected_electrical_power_w)


def test_occupants_add_moisture_to_the_room() -> None:
    occupied = new_app()
    unoccupied = new_app()
    for app in (occupied, unoccupied):
        app.state.environment.infiltration_ach = 0.0
        app.state.outdoor.humidity_percent = 0.0
    occupied.state.environment.occupancy = 2
    unoccupied.state.environment.occupancy = 0

    run_simulated_seconds(occupied, 60 * 60)
    run_simulated_seconds(unoccupied, 60 * 60)

    assert occupied.state.indoor.humidity_percent > unoccupied.state.indoor.humidity_percent


def test_window_flow_uses_opening_temperature_and_wind_and_respects_configured_cap() -> None:
    app = new_app()
    model = RoomModel(app.config.physics, app.config.scene)
    app.state.window.actual_position_percent = 100
    app.state.environment.wind_speed_m_s = 0
    app.state.indoor.temperature_c = app.state.outdoor.temperature_c
    assert model.window_airflow_m3_h(app.state) == 0

    app.state.indoor.temperature_c += 15
    stack_flow = model.window_airflow_m3_h(app.state)
    app.state.environment.wind_speed_m_s = 5
    wind_flow = model.window_airflow_m3_h(app.state)

    assert stack_flow > 0
    assert wind_flow > stack_flow
    assert wind_flow <= app.config.physics.window_max_airflow_m3_h
    app.state.window.actual_position_percent = 0
    assert model.window_airflow_m3_h(app.state) == 0


def test_model_remains_finite_nonnegative_and_bounded_for_a_day_long_step() -> None:
    app = new_app()
    app.state.environment.occupancy = 12
    app.state.environment.pm25_generation_ug_min = 800.0
    app.state.environment.wind_speed_m_s = 8.0
    app.state.outdoor.pm25_ug_m3 = 250.0
    app.state.outdoor.temperature_c = -20.0
    app.state.outdoor.humidity_percent = 85.0
    app.state.window.actual_position_percent = 100.0
    app.device_layer.set_intake_enabled(True)
    app.device_layer.set_exhaust_enabled(True)
    model = RoomModel(app.config.physics, app.config.scene)

    model.step(app.state, 24 * 60 * 60)

    readings = (
        app.state.indoor.co2_ppm,
        app.state.indoor.pm25_ug_m3,
        app.state.indoor.temperature_c,
        app.state.indoor.humidity_percent,
        app.state.energy.fan_energy_wh,
        app.state.energy.estimated_ventilation_heat_loss_wh,
        app.state.airflow.total_effective_m3_h,
    )
    assert all(math.isfinite(value) for value in readings)
    assert app.state.indoor.co2_ppm >= 0
    assert app.state.indoor.pm25_ug_m3 >= 0
    assert app.config.physics.minimum_room_temperature_c <= app.state.indoor.temperature_c <= (
        app.config.physics.maximum_room_temperature_c
    )
    assert app.config.physics.minimum_humidity_percent <= app.state.indoor.humidity_percent <= (
        app.config.physics.maximum_humidity_percent
    )


def test_fixed_ticks_give_same_result_at_different_fps_and_time_scales() -> None:
    at_60_fps = new_app()
    at_30_fps = new_app()
    accelerated = new_app()
    for app in (at_60_fps, at_30_fps, accelerated):
        app.device_layer.request_window_open()
        app.state.environment.occupancy = 2
    accelerated.simulation_engine.set_speed(60.0)

    for _ in range(60 * 60):
        at_60_fps.simulation_engine.advance(1.0 / 60.0)
    for _ in range(30 * 60):
        at_30_fps.simulation_engine.advance(1.0 / 30.0)
    for _ in range(60):
        accelerated.simulation_engine.advance(1.0 / 60.0)

    for app in (at_60_fps, at_30_fps, accelerated):
        assert app.state.elapsed_seconds == pytest.approx(60.0)
        assert app.state.window.actual_position_percent == pytest.approx(100.0)
    expected = at_60_fps.state.indoor
    for actual in (at_30_fps.state.indoor, accelerated.state.indoor):
        assert actual.co2_ppm == pytest.approx(expected.co2_ppm)
        assert actual.pm25_ug_m3 == pytest.approx(expected.pm25_ug_m3)
        assert actual.temperature_c == pytest.approx(expected.temperature_c)
        assert actual.humidity_percent == pytest.approx(expected.humidity_percent)
    assert at_60_fps.state.energy.fan_energy_wh == pytest.approx(
        accelerated.state.energy.fan_energy_wh
    )


def test_engine_pause_and_speed_options() -> None:
    app = new_app()
    app.simulation_engine.set_speed(30.0)
    app.simulation_engine.toggle_pause()
    assert app.state.simulation_speed == 0
    assert app.simulation_engine.advance(2.0) == 0
    app.simulation_engine.toggle_pause()
    assert app.state.simulation_speed == 30.0
    assert app.simulation_engine.advance(0.1) == 30

    with pytest.raises(ValueError, match="simulation speed"):
        app.simulation_engine.set_speed(3.0)
    with pytest.raises(ValueError, match="simulation speed"):
        app.simulation_engine.set_speed(float("nan"))
