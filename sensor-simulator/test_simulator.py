from datetime import datetime, timezone

import pytest

import simulator as simulator_module
from simulator import (
    SCENARIOS,
    SensorSimulator,
    SimulatorConfig,
    load_config,
    post_measurement,
)


def make_config(scenario: str) -> SimulatorConfig:
    return SimulatorConfig(
        backend_url="http://localhost:3000",
        device_id="room-01",
        interval_seconds=30,
        scenario=scenario,
        initial_co2=700,
        base_temperature=23,
        base_humidity=45,
        random_seed=42,
        retry_attempts=2,
        retry_base_delay_seconds=0,
        request_timeout_seconds=1,
        backfill_points=10,
        backfill_interval_seconds=30,
    )


@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
def test_sample_uses_the_public_esp32_contract(scenario):
    simulator = SensorSimulator(make_config(scenario))

    payload = simulator.sample(datetime(2026, 9, 6, tzinfo=timezone.utc))

    assert set(payload) == {"timestamp", "indoor", "outdoor", "window_open"}
    assert set(payload["indoor"]) == {"co2", "temperature", "humidity", "pm25"}
    assert set(payload["outdoor"]) == {"temperature", "humidity", "pm25"}
    assert isinstance(payload["window_open"], bool)


def test_closed_scenario_increases_co2_gradually():
    simulator = SensorSimulator(make_config("closed"))

    values = [simulator.sample()["indoor"]["co2"] for _ in range(4)]

    assert values[-1] > values[0]
    assert max(values[index + 1] - values[index] for index in range(3)) < 20


def test_open_scenario_reduces_co2_gradually():
    simulator = SensorSimulator(make_config("open"))

    values = [simulator.sample()["indoor"]["co2"] for _ in range(8)]

    assert values[-1] < values[0]
    assert max(abs(values[index + 1] - values[index]) for index in range(7)) < 100


def test_load_config_reads_scenario_and_intervals_from_environment(monkeypatch):
    monkeypatch.setenv("BACKEND_URL", "http://example.test:3000/")
    monkeypatch.setenv("SIMULATOR_INTERVAL_SECONDS", "12")
    monkeypatch.setenv("SCENARIO", "open")
    monkeypatch.setenv("RANDOM_SEED", "7")

    config = load_config()

    assert config.backend_url == "http://example.test:3000"
    assert config.interval_seconds == 12
    assert config.scenario == "open"
    assert config.random_seed == 7


def test_post_measurement_retries_after_a_temporary_backend_failure(monkeypatch):
    config = make_config("normal")
    attempts = []
    sleeps = []

    class Response:
        status = 201

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def read(self):
            return b"{}"

    def fake_urlopen(request, timeout):
        attempts.append((request.full_url, timeout))
        if len(attempts) == 1:
            raise simulator_module.URLError("temporary failure")
        return Response()

    monkeypatch.setattr(simulator_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(simulator_module.time, "sleep", sleeps.append)

    post_measurement(config, {"timestamp": "2026-09-06T10:00:00Z"})

    assert len(attempts) == 2
    assert sleeps == [0]


def test_live_mode_stops_cleanly_after_stop_event(monkeypatch):
    config = make_config("normal")
    stop_event = simulator_module.threading.Event()
    sent = []

    def fake_post(current_config, payload):
        sent.append(payload)
        stop_event.set()

    monkeypatch.setattr(simulator_module, "post_measurement", fake_post)

    simulator_module.run_live(config, stop_event)

    assert len(sent) == 1
