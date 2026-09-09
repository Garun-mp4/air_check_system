from datetime import datetime, timedelta, timezone

import pytest

from feature_schema import (
    FEATURE_NAMES,
    FeatureError,
    build_training_rows,
    feature_row_from_prediction_payload,
)


def make_measurements(points: int = 61) -> list[dict]:
    start = datetime(2026, 9, 6, 10, 0, tzinfo=timezone.utc)
    result = []
    for index in range(points):
        timestamp = start + timedelta(seconds=30 * index)
        result.append(
            {
                "id": index + 1,
                "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
                "indoor": {
                    "co2": 600 + index * 4,
                    "temperature": 23.0,
                    "humidity": 45.0,
                    "pm25": 4.0,
                },
                "outdoor": {
                    "temperature": 17.5,
                    "humidity": 64.0,
                    "pm25": 8.0,
                },
                "window_open": False,
            }
        )
    return result


def test_training_rows_use_only_available_past_features_and_future_target():
    rows = build_training_rows(make_measurements())

    assert len(rows) > 0
    row = rows[0]
    assert list(row["features"]) == FEATURE_NAMES
    assert row["features"]["co2_change_5min"] == pytest.approx(40)
    assert row["features"]["co2_change_10min"] == pytest.approx(80)
    assert row["co2_after_15min"] == pytest.approx(800)


def test_insufficient_history_is_excluded_without_random_fill():
    rows = build_training_rows(make_measurements(points=20))

    assert rows == []


def test_training_rejects_a_non_boolean_window_state():
    measurements = make_measurements()
    measurements[0]["window_open"] = "false"

    with pytest.raises(FeatureError, match="window_open must be boolean"):
        build_training_rows(measurements)


def test_prediction_payload_has_stable_feature_order():
    payload = {
        "co2": 920,
        "temperature": 23.4,
        "humidity": 44,
        "indoor_pm25": 5,
        "outdoor_temperature": 17.8,
        "outdoor_humidity": 68,
        "outdoor_pm25": 8,
        "window_open": False,
        "co2_change_5min": 45,
        "co2_change_10min": 80,
        "hour": 14,
    }

    row = feature_row_from_prediction_payload(payload)

    assert row == [920.0, 23.4, 44.0, 5.0, 17.8, 68.0, 8.0, 0.0, 45.0, 80.0, 14.0]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("window_open", "false"),
        ("co2", -1),
        ("hour", 24),
    ],
)
def test_prediction_payload_rejects_invalid_values(field, value):
    payload = {
        "co2": 920,
        "temperature": 23.4,
        "humidity": 44,
        "indoor_pm25": 5,
        "outdoor_temperature": 17.8,
        "outdoor_humidity": 68,
        "outdoor_pm25": 8,
        "window_open": False,
        "co2_change_5min": 45,
        "co2_change_10min": 80,
        "hour": 14,
    }
    payload[field] = value

    with pytest.raises(FeatureError):
        feature_row_from_prediction_payload(payload)
