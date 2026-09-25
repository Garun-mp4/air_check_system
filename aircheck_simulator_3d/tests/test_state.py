from datetime import datetime, timezone
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.devices.models import WindowDeviceState, WindowMotorState
from aircheck_simulator_3d.simulation.state import AirQualityState, SimulationState


CONFIG_DIR = Path(__file__).parents[1] / "config"


def test_application_builds_one_consistent_initial_state() -> None:
    app = Application(load_config(CONFIG_DIR, {}))

    assert app.state.indoor.co2_ppm == 650
    assert app.state.outdoor.co2_ppm == 420
    assert app.state.room_volume_m3 == 48
    assert app.state.window.actual_position_percent == 0
    assert app.state.window.close_limit_switch
    assert not app.state.window.reed_switch
    assert app.state.controller.device_id == "room-01"
    assert [(sensor.model, sensor.zone) for sensor in app.state.sensors] == [
        ("Sensirion SCD41", "indoor"),
        ("Sensirion SPS30", "indoor"),
        ("Sensirion SHT45", "outdoor"),
        ("Sensirion SPS30", "outdoor"),
    ]
    assert not app.state.ventilation.intake.enabled
    assert not app.state.ventilation.exhaust.enabled


def test_state_requires_timezone_and_valid_air_reading() -> None:
    with pytest.raises(ValueError, match="finite"):
        AirQualityState(float("nan"), 1, 20, 40)
    with pytest.raises(ValueError, match="timezone"):
        SimulationState(
            simulated_at=datetime(2026, 1, 1),
            elapsed_seconds=0,
            simulation_speed=1,
            fixed_step_seconds=1,
            room_volume_m3=20,
            indoor=AirQualityState(600, 3, 22, 40),
            outdoor=AirQualityState(420, 8, 15, 60),
            window=WindowDeviceState(0, 0, WindowMotorState.STOPPED, False, False, True),
            ventilation=Application(load_config(CONFIG_DIR, {})).state.ventilation,
            controller=Application(load_config(CONFIG_DIR, {})).state.controller,
            sensors=Application(load_config(CONFIG_DIR, {})).state.sensors,
            environment=Application(load_config(CONFIG_DIR, {})).state.environment,
        )


def test_application_closes_window_even_if_run_raises() -> None:
    events: list[str] = []

    class FakeWindow:
        def __init__(self, _config: object) -> None:
            events.append("created")

        def run(self, smoke_test_seconds: float | None = None) -> None:
            assert smoke_test_seconds == 0.5
            events.append("run")
            raise RuntimeError("window loop failed")

        def close(self) -> None:
            events.append("closed")

    with pytest.raises(RuntimeError, match="window loop failed"):
        Application(load_config(CONFIG_DIR, {}), FakeWindow).run(smoke_test_seconds=0.5)

    assert events == ["created", "run", "closed"]
