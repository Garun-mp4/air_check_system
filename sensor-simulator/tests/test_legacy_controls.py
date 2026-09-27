from __future__ import annotations

import json
import threading

import simulator as simulator_module
from simulator import (
    SensorSimulator,
    SimulatorConfig,
    get_pending_control_commands,
    report_control_state,
    run_live,
    sync_controls,
)


class FakeResponse:
    def __init__(self, body: bytes = b"{}", status: int = 200) -> None:
        self.body = body
        self.status = status

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> bool:
        return False

    def read(self) -> bytes:
        return self.body


def make_config() -> SimulatorConfig:
    return SimulatorConfig(
        backend_url="http://backend.example",
        device_id="room-07",
        interval_seconds=30,
        scenario="normal",
        initial_co2=700,
        base_temperature=23,
        base_humidity=45,
        random_seed=42,
        retry_attempts=2,
        retry_base_delay_seconds=0,
        request_timeout_seconds=2.5,
        backfill_points=10,
        backfill_interval_seconds=30,
        device_api_token="unit-test-token",
    )


def test_control_polling_applies_commands_and_reports_actual_state_and_ids(monkeypatch) -> None:
    config = make_config()
    simulator = SensorSimulator(config)
    commands = [
        {"id": 101, "target": "exhaust", "desired_state": True},
        {"id": 102, "target": "intake", "desired_state": True},
        {"id": 103, "target": "window", "desired_state": True},
        {"id": 104, "target": "unknown", "desired_state": True},
        {"id": 105, "target": "window", "desired_state": "open"},
        "malformed list item",
    ]
    calls = []

    def fake_urlopen(request, timeout):
        calls.append((request, timeout))
        if request.get_method() == "GET":
            return FakeResponse(json.dumps({"data": commands}).encode("utf-8"))
        return FakeResponse(status=204)

    monkeypatch.setattr(simulator_module, "urlopen", fake_urlopen)

    pending = get_pending_control_commands(config)
    assert pending == commands[:-1]
    assert sync_controls(config, simulator) is None
    assert simulator.exhaust_on and simulator.intake_on and simulator.window_open
    assert simulator.applied_command_ids == [101, 102, 103]

    timestamp = "2026-09-06T10:00:00Z"
    measurement = simulator.sample(simulator_module.datetime.fromisoformat(timestamp.replace("Z", "+00:00")))
    assert measurement["window_open"] is True
    report_control_state(config, simulator, timestamp)

    assert len(calls) == 3
    get_request, get_timeout = calls[0]
    assert get_request.full_url == (
        "http://backend.example/api/v1/controls/commands?device_id=room-07&limit=20"
    )
    assert get_request.get_method() == "GET"
    assert get_request.get_header("Authorization") == "Bearer unit-test-token"
    assert get_timeout == config.request_timeout_seconds

    sync_request, _ = calls[1]
    state_request, state_timeout = calls[2]
    assert sync_request.get_method() == "GET"
    assert state_request.full_url == "http://backend.example/api/v1/controls/state"
    assert state_request.get_method() == "POST"
    assert state_request.get_header("Authorization") == "Bearer unit-test-token"
    assert state_request.get_header("Content-type") == "application/json"
    assert state_timeout == config.request_timeout_seconds
    assert json.loads(state_request.data.decode("utf-8")) == {
        "device_id": "room-07",
        "timestamp": timestamp,
        "exhaust_on": True,
        "intake_on": True,
        "window_open": True,
        "applied_command_ids": [101, 102, 103],
    }
    assert simulator.applied_command_ids == []


def test_live_cycle_keeps_sampling_when_command_poll_is_offline(monkeypatch) -> None:
    config = make_config()
    stop_event = threading.Event()
    calls = []

    def fail_poll(current_config, simulator):
        calls.append("poll")
        raise simulator_module.URLError("backend offline")

    def send_measurement(current_config, payload):
        calls.append("measurement")
        assert payload["timestamp"].endswith("Z")
        stop_event.set()

    def send_state(current_config, simulator, timestamp):
        calls.append("state")
        assert simulator.applied_command_ids == []

    monkeypatch.setattr(simulator_module, "sync_controls", fail_poll)
    monkeypatch.setattr(simulator_module, "post_measurement", send_measurement)
    monkeypatch.setattr(simulator_module, "report_control_state", send_state)

    run_live(config, stop_event)

    assert calls == ["poll", "measurement", "state"]
