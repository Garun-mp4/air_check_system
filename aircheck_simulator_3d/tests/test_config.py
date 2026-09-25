from pathlib import Path

import pytest

from aircheck_simulator_3d.app.config import ConfigurationError, load_config


CONFIG_DIR = Path(__file__).parents[1] / "config"


def test_load_config_and_legacy_environment_names() -> None:
    config = load_config(
        CONFIG_DIR,
        {
            "BACKEND_URL": "http://aircheck.test/",
            "DASHBOARD_URL": "https://dashboard.test/",
            "DEVICE_ID": "room-west",
            "SIMULATOR_INTERVAL_SECONDS": "12.5",
            "REQUEST_TIMEOUT_SECONDS": "3",
            "INITIAL_CO2": "720",
            "BASE_TEMPERATURE": "24",
            "BASE_HUMIDITY": "50",
            "RETRY_ATTEMPTS": "5",
            "RETRY_BASE_DELAY_SECONDS": "2",
            "LOG_LEVEL": "DEBUG",
        },
    )

    assert config.backend.backend_url == "http://aircheck.test"
    assert config.backend.resolved_dashboard_url == "https://dashboard.test"
    assert config.devices.device_id == "room-west"
    assert config.backend.telemetry_interval_seconds == 12.5
    assert config.backend.request_timeout_seconds == 3
    assert config.backend.retry_attempts == 5
    assert config.backend.retry_base_delay_seconds == 2
    assert config.room.initial_indoor.co2_ppm == 720
    assert config.room.initial_indoor.temperature_c == 24
    assert config.room.initial_indoor.humidity_percent == 50
    assert config.logging.level == "DEBUG"


def test_dashboard_defaults_to_configured_backend() -> None:
    config = load_config(CONFIG_DIR, {})

    assert config.backend.resolved_dashboard_url == config.backend.backend_url
    assert config.room.co2_generation_l_min_per_person == pytest.approx(0.30)
    assert config.physics.fixed_step_seconds == pytest.approx(0.1)
    assert config.physics.simulation_speeds == (1.0, 2.0, 5.0, 10.0, 30.0, 60.0)
    assert config.devices.filter_enabled
    assert 0 < config.devices.intake_efficiency <= 1


def test_invalid_backend_url_is_rejected(tmp_path: Path) -> None:
    for source in CONFIG_DIR.glob("*.toml"):
        (tmp_path / source.name).write_bytes(source.read_bytes())
    backend_path = tmp_path / "backend.toml"
    backend_path.write_text(
        backend_path.read_text(encoding="utf-8").replace("http://localhost:3000", "localhost:3000"),
        encoding="utf-8",
    )

    with pytest.raises(ConfigurationError, match="absolute HTTP"):
        load_config(tmp_path, {})


def test_missing_configuration_is_reported(tmp_path: Path) -> None:
    with pytest.raises(ConfigurationError, match="cannot read configuration"):
        load_config(tmp_path, {})


def test_legacy_environment_values_that_break_api_validation_are_rejected() -> None:
    with pytest.raises(ConfigurationError, match="AirCheck measurement ranges"):
        load_config(CONFIG_DIR, {"INITIAL_CO2": "100"})

    with pytest.raises(ConfigurationError, match="RETRY_ATTEMPTS must be an integer"):
        load_config(CONFIG_DIR, {"RETRY_ATTEMPTS": "many"})
