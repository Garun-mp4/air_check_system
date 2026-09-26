from __future__ import annotations

import math
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.devices.models import WindowMotorState


CONFIG_DIR = Path(__file__).parents[1] / "config"


@pytest.mark.parametrize("days", (1, 7))
def test_accelerated_day_and_week_runs_remain_finite_and_consistent(days: int) -> None:
    app = Application(load_config(CONFIG_DIR, {}))
    state = app.state
    state.fixed_step_seconds = 3600.0
    app.simulation_engine.set_speed(60.0)
    state.environment.wind_speed_m_s = 2.5
    state.environment.occupancy = 4
    state.outdoor.temperature_c = -5.0
    state.outdoor.pm25_ug_m3 = 35.0
    app.device_layer.set_intake_enabled(True)
    app.device_layer.set_exhaust_enabled(True)

    total_hours = days * 24
    for hour in range(total_hours):
        hour_of_day = hour % 24
        if hour_of_day == 7:
            app.device_layer.request_window_open()
        elif hour_of_day == 9:
            app.device_layer.request_window_close()
        state.environment.occupancy = 4 if 8 <= hour_of_day < 18 else 0
        state.outdoor.pm25_ug_m3 = 120.0 if 24 <= hour < 48 else 8.0

        # At 60x this 60-second wall interval advances one simulated hour.
        assert app.simulation_engine.advance(60.0) == 1

        numeric_state = (
            state.indoor.co2_ppm,
            state.indoor.pm25_ug_m3,
            state.indoor.temperature_c,
            state.indoor.humidity_percent,
            state.airflow.total_effective_m3_h,
            state.energy.fan_energy_wh,
            state.energy.estimated_ventilation_heat_loss_wh,
            state.energy.total_relative_energy,
            state.window.actual_position_percent,
        )
        assert all(math.isfinite(value) for value in numeric_state)
        assert state.indoor.co2_ppm >= 0
        assert state.indoor.pm25_ug_m3 >= 0
        assert app.config.physics.minimum_room_temperature_c <= state.indoor.temperature_c <= (
            app.config.physics.maximum_room_temperature_c
        )
        assert app.config.physics.minimum_humidity_percent <= state.indoor.humidity_percent <= (
            app.config.physics.maximum_humidity_percent
        )
        assert 0 <= state.window.actual_position_percent <= 100
        assert state.window.reed_switch == (
            state.window.actual_position_percent >= app.config.devices.window_reed_open_threshold_percent
        )
        if state.window.open_limit_switch or state.window.close_limit_switch:
            assert state.window.motor_state is WindowMotorState.STOPPED

    assert state.elapsed_seconds == pytest.approx(total_hours * 3600)
    assert state.indoor.co2_ppm > 0
    assert state.energy.total_relative_energy > 0
