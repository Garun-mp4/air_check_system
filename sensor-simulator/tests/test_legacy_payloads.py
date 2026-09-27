from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone

import pytest

from simulator import SCENARIOS, SensorSimulator, SimulatorConfig


def make_config(scenario: str, *, random_seed: int = 42) -> SimulatorConfig:
    return SimulatorConfig(
        backend_url="http://backend.example",
        device_id="room-01",
        interval_seconds=30,
        scenario=scenario,
        initial_co2=700,
        base_temperature=23,
        base_humidity=45,
        random_seed=random_seed,
        retry_attempts=3,
        retry_base_delay_seconds=0.25,
        request_timeout_seconds=1.5,
        backfill_points=10,
        backfill_interval_seconds=30,
        device_api_token="test-device-token",
    )


@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
def test_sample_is_a_finite_json_measurement_with_utc_timestamp(scenario: str) -> None:
    simulator = SensorSimulator(make_config(scenario))
    local_timestamp = datetime(
        2026, 9, 6, 13, 5, tzinfo=timezone(timedelta(hours=3))
    )

    payload = simulator.sample(local_timestamp)

    assert payload["timestamp"] == "2026-09-06T10:05:00Z"
    assert isinstance(payload["window_open"], bool)
    assert json.loads(json.dumps(payload, allow_nan=False)) == payload
    readings = [
        value
        for section in (payload["indoor"], payload["outdoor"])
        for value in section.values()
    ]
    assert all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in readings)
    assert all(math.isfinite(value) for value in readings)


@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
def test_scenario_sequence_is_reproducible_for_same_seed(scenario: str) -> None:
    first = SensorSimulator(make_config(scenario, random_seed=17))
    second = SensorSimulator(make_config(scenario, random_seed=17))
    timestamps = [
        datetime(2026, 9, 6, 10, minute, tzinfo=timezone.utc)
        for minute in range(4)
    ]

    first_samples = [first.sample(timestamp) for timestamp in timestamps]
    second_samples = [second.sample(timestamp) for timestamp in timestamps]

    assert first_samples == second_samples
