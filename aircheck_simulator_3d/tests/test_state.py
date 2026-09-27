from dataclasses import replace
from datetime import datetime
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.simulation.factory import create_initial_state
from aircheck_simulator_3d.simulation.state import AirQualityState


CONFIG_DIR = Path(__file__).parents[1] / "config"


def test_factory_builds_one_consistent_initial_state() -> None:
    state = create_initial_state(load_config(CONFIG_DIR, {}))

    assert state.indoor.co2_ppm == 650
    assert state.outdoor.co2_ppm == 420
    assert state.room_volume_m3 == 48
    assert state.window.actual_position_percent == 0
    assert state.window.close_limit_switch
    assert not state.window.reed_switch
    assert state.controller.device_id == "room-01"
    assert [(sensor.model, sensor.zone) for sensor in state.sensors] == [
        ("Sensirion SCD41", "indoor"),
        ("Sensirion SPS30", "indoor"),
        ("Sensirion SHT45", "outdoor"),
        ("Sensirion SPS30", "outdoor"),
    ]
    assert not state.ventilation.intake.enabled
    assert not state.ventilation.exhaust.enabled


def test_state_requires_timezone_and_valid_air_reading() -> None:
    state = create_initial_state(load_config(CONFIG_DIR, {}))

    with pytest.raises(ValueError, match="finite"):
        AirQualityState(float("nan"), 1, 20, 40)
    with pytest.raises(ValueError, match="timezone"):
        replace(state, simulated_at=datetime(2026, 1, 1))
