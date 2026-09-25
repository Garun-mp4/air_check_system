from datetime import datetime, timezone
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.networking.contracts import (
    ApiRoutes,
    CommandTarget,
    ControlStateReport,
    MeasurementPayload,
    PendingControlCommand,
)


CONFIG_DIR = Path(__file__).parents[1] / "config"


def test_measurement_matches_aircheck_contract() -> None:
    state = Application(load_config(CONFIG_DIR, {})).state
    payload = MeasurementPayload.from_state(state, datetime(2026, 9, 6, 10, tzinfo=timezone.utc)).to_mapping()

    assert set(payload) == {"timestamp", "indoor", "outdoor", "window_open"}
    assert payload["timestamp"] == "2026-09-06T10:00:00Z"
    assert set(payload["indoor"]) == {"co2", "temperature", "humidity", "pm25"}
    assert set(payload["outdoor"]) == {"temperature", "humidity", "pm25"}
    assert "co2" not in payload["outdoor"]
    assert payload["window_open"] is False


def test_control_report_uses_measured_state_and_ack_ids() -> None:
    state = Application(load_config(CONFIG_DIR, {})).state
    state.ventilation.intake.enabled = True
    report = ControlStateReport.from_state(
        "room-01", datetime(2026, 9, 6, 10, tzinfo=timezone.utc), state, (101, 102)
    ).to_mapping()

    assert report == {
        "device_id": "room-01",
        "timestamp": "2026-09-06T10:00:00Z",
        "exhaust_on": False,
        "intake_on": True,
        "window_open": False,
        "applied_command_ids": [101, 102],
    }


def test_pending_command_uses_existing_backend_fields() -> None:
    command = PendingControlCommand.from_mapping(
        {"id": 104, "target": "window", "desired_state": True, "source": "automation", "batch_id": "batch-1"}
    )

    assert command.command_id == 104
    assert command.target is CommandTarget.WINDOW
    assert command.desired_state is True
    assert command.batch_id == "batch-1"


@pytest.mark.parametrize(
    "raw",
    [
        {"id": True, "target": "window", "desired_state": True},
        {"id": 1, "target": "unknown", "desired_state": True},
        {"id": 1, "target": "window", "desired_state": 1},
    ],
)
def test_malformed_pending_command_is_rejected(raw: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        PendingControlCommand.from_mapping(raw)


def test_api_routes_match_existing_server_prefix_and_query() -> None:
    routes = ApiRoutes("http://localhost:3000")

    assert routes.measurements == "http://localhost:3000/api/v1/measurements"
    assert routes.pending_commands("room 01", 20) == (
        "http://localhost:3000/api/v1/controls/commands?device_id=room+01&limit=20"
    )
    assert routes.control_state == "http://localhost:3000/api/v1/controls/state"
