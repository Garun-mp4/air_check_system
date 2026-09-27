from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from urllib.error import HTTPError, URLError

import simulator as simulator_module
from simulator import SimulatorConfig, post_measurement, run_backfill


class FakeResponse:
    status = 201

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> bool:
        return False

    def read(self) -> bytes:
        return b"{}"


def make_config(*, retry_attempts: int = 3, retry_delay: float = 0.25) -> SimulatorConfig:
    return SimulatorConfig(
        backend_url="http://backend.example",
        device_id="room-01",
        interval_seconds=30,
        scenario="normal",
        initial_co2=700,
        base_temperature=23,
        base_humidity=45,
        random_seed=42,
        retry_attempts=retry_attempts,
        retry_base_delay_seconds=retry_delay,
        request_timeout_seconds=1.25,
        backfill_points=10,
        backfill_interval_seconds=30,
        device_api_token="test-device-token",
    )


def test_measurement_retries_http_and_network_errors_with_exponential_delays(monkeypatch) -> None:
    config = make_config()
    attempts = []
    delays = []
    payload = {
        "timestamp": "2026-09-06T10:00:00Z",
        "indoor": {"co2": 700, "temperature": 23, "humidity": 45, "pm25": 5},
        "outdoor": {"temperature": 18, "humidity": 62, "pm25": 8},
        "window_open": False,
    }

    def flaky_urlopen(request, timeout):
        attempts.append((request, timeout))
        if len(attempts) == 1:
            raise HTTPError(request.full_url, 503, "temporarily unavailable", None, None)
        if len(attempts) == 2:
            raise URLError("connection reset")
        return FakeResponse()

    monkeypatch.setattr(simulator_module, "urlopen", flaky_urlopen)
    monkeypatch.setattr(simulator_module.time, "sleep", delays.append)

    post_measurement(config, payload)

    assert len(attempts) == 3
    assert delays == [0.25, 0.5]
    assert all(request.full_url == "http://backend.example/api/v1/measurements" for request, _ in attempts)
    assert all(request.get_method() == "POST" for request, _ in attempts)
    assert all(timeout == config.request_timeout_seconds for _, timeout in attempts)
    assert all(request.data == json.dumps(payload, ensure_ascii=False).encode("utf-8") for request, _ in attempts)
    assert all(request.get_header("Authorization") == "Bearer test-device-token" for request, _ in attempts)


def test_measurement_reports_exhausted_timeouts_after_configured_attempts(monkeypatch) -> None:
    config = make_config(retry_attempts=3, retry_delay=0.1)
    attempts = []
    delays = []

    def always_timeout(request, timeout):
        attempts.append((request, timeout))
        raise TimeoutError("request timed out")

    monkeypatch.setattr(simulator_module, "urlopen", always_timeout)
    monkeypatch.setattr(simulator_module.time, "sleep", delays.append)

    with pytest.raises(RuntimeError, match="unable to send measurement after 3 attempts: request timed out"):
        post_measurement(config, {"timestamp": "2026-09-06T10:00:00Z"})

    assert len(attempts) == 3
    assert delays == [0.1, 0.2]


def test_backfill_posts_requested_count_reproducibly_for_fixed_clock(monkeypatch) -> None:
    config = make_config()
    posted = []

    class FixedClock:
        @staticmethod
        def now(tz=None):
            return datetime(2026, 9, 6, 10, tzinfo=timezone.utc)

    monkeypatch.setattr(simulator_module, "datetime", FixedClock)
    monkeypatch.setattr(simulator_module, "post_measurement", lambda current, payload: posted.append(payload))

    first_count = run_backfill(config, points=4, interval=15)
    first_run = posted.copy()
    posted.clear()
    second_count = run_backfill(config, points=4, interval=15)

    assert first_count == second_count == 4
    assert len(first_run) == len(posted) == 4
    assert posted == first_run
    assert all(payload["timestamp"].endswith("Z") for payload in posted)
    assert all("indoor" in payload and "outdoor" in payload for payload in posted)
