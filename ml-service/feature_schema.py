from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any


FEATURE_NAMES = [
    "current_co2",
    "indoor_temperature",
    "indoor_humidity",
    "indoor_pm25",
    "outdoor_temperature",
    "outdoor_humidity",
    "outdoor_pm25",
    "window_open",
    "co2_change_5min",
    "co2_change_10min",
    "hour",
]

PREDICTION_FIELDS = [
    "co2",
    "temperature",
    "humidity",
    "indoor_pm25",
    "outdoor_temperature",
    "outdoor_humidity",
    "outdoor_pm25",
    "window_open",
    "co2_change_5min",
    "co2_change_10min",
    "hour",
]

LOOKBACK_5_MINUTES = timedelta(minutes=5)
LOOKBACK_10_MINUTES = timedelta(minutes=10)
HORIZON_15_MINUTES = timedelta(minutes=15)
MAX_LOOKBACK_GAP = timedelta(minutes=2)
MAX_TARGET_GAP = timedelta(minutes=2)


class FeatureError(ValueError):
    pass


class InsufficientHistoryError(FeatureError):
    pass


def parse_timestamp(value: Any) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise FeatureError("timestamp is required")
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise FeatureError("timestamp must be RFC3339") from exc
    if parsed.tzinfo is None:
        raise FeatureError("timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def validate_prediction_payload(payload: Any) -> None:
    if not isinstance(payload, dict):
        raise FeatureError("JSON body must be an object")
    missing = [field for field in PREDICTION_FIELDS if field not in payload]
    if missing:
        raise FeatureError("missing fields: " + ", ".join(missing))
    if type(payload["window_open"]) is not bool:
        raise FeatureError("window_open must be boolean")
    for field in PREDICTION_FIELDS:
        if field == "window_open":
            continue
        value = payload[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise FeatureError(f"{field} must be a finite number")
    if payload["co2"] < 0:
        raise FeatureError("co2 must be non-negative")
    if not 0 <= payload["hour"] <= 23:
        raise FeatureError("hour must be between 0 and 23")


def feature_row_from_prediction_payload(payload: dict[str, Any]) -> list[float]:
    validate_prediction_payload(payload)
    return [
        float(payload["co2"]),
        float(payload["temperature"]),
        float(payload["humidity"]),
        float(payload["indoor_pm25"]),
        float(payload["outdoor_temperature"]),
        float(payload["outdoor_humidity"]),
        float(payload["outdoor_pm25"]),
        1.0 if payload["window_open"] else 0.0,
        float(payload["co2_change_5min"]),
        float(payload["co2_change_10min"]),
        float(payload["hour"]),
    ]


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise FeatureError(f"{field} must be a finite number")
    return float(value)


def flatten_measurement(measurement: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(measurement, dict):
        raise FeatureError("measurement must be an object")
    indoor = measurement.get("indoor") or {}
    outdoor = measurement.get("outdoor") or {}

    def value(nested: dict[str, Any], nested_key: str, flat_key: str) -> Any:
        if nested_key in nested:
            return nested[nested_key]
        return measurement.get(flat_key)

    timestamp = parse_timestamp(measurement.get("timestamp"))
    return {
        "timestamp": timestamp,
        "co2": _number(value(indoor, "co2", "indoor_co2"), "indoor.co2"),
        "temperature": _number(value(indoor, "temperature", "indoor_temperature"), "indoor.temperature"),
        "humidity": _number(value(indoor, "humidity", "indoor_humidity"), "indoor.humidity"),
        "indoor_pm25": _number(value(indoor, "pm25", "indoor_pm25"), "indoor.pm25"),
        "outdoor_temperature": _number(
            value(outdoor, "temperature", "outdoor_temperature"), "outdoor.temperature"
        ),
        "outdoor_humidity": _number(value(outdoor, "humidity", "outdoor_humidity"), "outdoor.humidity"),
        "outdoor_pm25": _number(value(outdoor, "pm25", "outdoor_pm25"), "outdoor.pm25"),
        "window_open": measurement.get("window_open"),
    }


def _measurement_sort_key(record: dict[str, Any]) -> tuple[datetime, int]:
    return record["timestamp"], int(record.get("id", 0))


def _lookup_at_or_before(
    records: list[dict[str, Any]], target: datetime, max_gap: timedelta
) -> dict[str, Any] | None:
    for record in reversed(records):
        if record["timestamp"] > target:
            continue
        if target - record["timestamp"] > max_gap:
            return None
        return record
    return None


def _lookup_at_or_after(
    records: list[dict[str, Any]], target: datetime, max_gap: timedelta
) -> dict[str, Any] | None:
    for record in records:
        if record["timestamp"] < target:
            continue
        if record["timestamp"] - target > max_gap:
            return None
        return record
    return None


def build_training_rows(measurements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = sorted((flatten_measurement(item) | {"id": item.get("id", 0)} for item in measurements), key=_measurement_sort_key)
    rows: list[dict[str, Any]] = []
    for index, current in enumerate(records):
        history = records[: index + 1]
        previous_5 = _lookup_at_or_before(history, current["timestamp"] - LOOKBACK_5_MINUTES, MAX_LOOKBACK_GAP)
        previous_10 = _lookup_at_or_before(history, current["timestamp"] - LOOKBACK_10_MINUTES, MAX_LOOKBACK_GAP)
        target = _lookup_at_or_after(
            records[index + 1 :],
            current["timestamp"] + HORIZON_15_MINUTES,
            MAX_TARGET_GAP,
        )
        if previous_5 is None or previous_10 is None or target is None:
            continue
        features = {
            "current_co2": current["co2"],
            "indoor_temperature": current["temperature"],
            "indoor_humidity": current["humidity"],
            "indoor_pm25": current["indoor_pm25"],
            "outdoor_temperature": current["outdoor_temperature"],
            "outdoor_humidity": current["outdoor_humidity"],
            "outdoor_pm25": current["outdoor_pm25"],
            "window_open": 1.0 if current["window_open"] is True else 0.0,
            "co2_change_5min": current["co2"] - previous_5["co2"],
            "co2_change_10min": current["co2"] - previous_10["co2"],
            "hour": float(current["timestamp"].hour),
        }
        rows.append(
            {
                "timestamp": current["timestamp"],
                "features": features,
                "co2_after_15min": target["co2"],
            }
        )
    return rows


def rows_to_matrix(rows: list[dict[str, Any]]) -> tuple[list[list[float]], list[float]]:
    matrix = [
        [float(row["features"][name]) for name in FEATURE_NAMES]
        for row in rows
    ]
    target = [float(row["co2_after_15min"]) for row in rows]
    return matrix, target

