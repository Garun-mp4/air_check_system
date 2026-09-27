from __future__ import annotations

import copy
import http.client
import json
import math
import threading
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from typing import Any

import joblib
import pytest

import app as ml_app
import modeling
import predict as predict_module
from feature_schema import (
    FEATURE_NAMES,
    PREDICTION_FIELDS,
    FeatureError,
    build_training_rows,
    feature_row_from_prediction_payload,
    flatten_measurement,
)
from modeling import train_and_evaluate
from predict import ModelUnavailableError, Predictor


EXPECTED_FEATURE_NAMES = [
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

EXPECTED_PREDICTION_FIELDS = [
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


def make_measurements(points: int = 61) -> list[dict[str, Any]]:
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


def prediction_payload() -> dict[str, Any]:
    return {
        "co2": 1234,
        "temperature": 20.5,
        "humidity": 41.25,
        "indoor_pm25": 4.5,
        "outdoor_temperature": 13.75,
        "outdoor_humidity": 62.5,
        "outdoor_pm25": 8.25,
        "window_open": True,
        "co2_change_5min": 17.5,
        "co2_change_10min": 55.25,
        "hour": 13,
    }


class ConstantRegressor:
    def __init__(self, value: float) -> None:
        self.value = value

    def predict(self, features: list[list[float]]) -> list[float]:
        return [self.value for _ in features]


@pytest.fixture(scope="module")
def ml_http_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), ml_app.RequestHandler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield server.server_address
    finally:
        server.shutdown()
        worker.join(timeout=2)
        server.server_close()


def post_json(address: tuple[str, int], payload: Any):
    connection = http.client.HTTPConnection(address[0], address[1], timeout=2)
    connection.request(
        "POST",
        "/predict",
        body=json.dumps(payload),
        headers={"Content-Type": "application/json"},
    )
    response = connection.getresponse()
    status = response.status
    content_type = response.getheader("Content-Type")
    body = json.loads(response.read().decode("utf-8"))
    connection.close()
    return status, content_type, body


def test_documented_feature_and_payload_schemas_are_complete_and_ordered():
    assert FEATURE_NAMES == EXPECTED_FEATURE_NAMES
    assert PREDICTION_FIELDS == EXPECTED_PREDICTION_FIELDS

    row = feature_row_from_prediction_payload(prediction_payload())

    assert row == [
        1234.0,
        20.5,
        41.25,
        4.5,
        13.75,
        62.5,
        8.25,
        1.0,
        17.5,
        55.25,
        13.0,
    ]


@pytest.mark.parametrize("field", EXPECTED_PREDICTION_FIELDS)
def test_prediction_payload_rejects_each_missing_documented_field(field: str):
    payload = prediction_payload()
    payload.pop(field)

    with pytest.raises(FeatureError, match=f"missing fields: {field}"):
        feature_row_from_prediction_payload(payload)


@pytest.mark.parametrize(
    ("invalid_kind", "expected_message"),
    [
        ("timezone", "timestamp must include a timezone"),
        ("non_finite", "indoor.co2 must be a finite number"),
    ],
)
def test_training_rejects_history_with_invalid_timestamps_or_sensor_values(
    invalid_kind: str, expected_message: str
):
    measurements = make_measurements()
    if invalid_kind == "timezone":
        measurements[0]["timestamp"] = "2026-09-06T10:00:00"
    else:
        measurements[0]["indoor"]["co2"] = math.nan

    with pytest.raises(FeatureError, match=expected_message):
        flatten_measurement(measurements[0])


def test_training_rows_without_a_future_target_are_excluded():
    rows = build_training_rows(make_measurements(points=50))

    assert rows == []


def test_training_features_ignore_measurements_after_the_current_timestamp():
    measurements = make_measurements(points=100)
    changed_future = copy.deepcopy(measurements)
    for measurement in changed_future[21:]:
        measurement["indoor"]["co2"] += 10_000

    target_time = datetime(2026, 9, 6, 10, 10, tzinfo=timezone.utc)
    baseline = next(row for row in build_training_rows(measurements) if row["timestamp"] == target_time)
    changed = next(row for row in build_training_rows(changed_future) if row["timestamp"] == target_time)

    assert changed["features"] == baseline["features"]
    assert changed["co2_after_15min"] == baseline["co2_after_15min"] + 10_000


def test_training_split_fits_only_the_oldest_rows_and_evaluates_the_newest(
    tmp_path, monkeypatch
):
    class RecordingRegressor:
        def __init__(self, name: str):
            self.name = name
            self.fit_features = None
            self.fit_targets = None
            self.evaluation_features = None

        def fit(self, features, targets):
            self.fit_features = features.copy()
            self.fit_targets = targets.copy()
            return self

        def predict(self, features):
            self.evaluation_features = features.copy()
            return [0.0 for _ in features]

    regressors: dict[str, RecordingRegressor] = {}

    def make_regressor(name: str):
        def create(**_kwargs):
            regressors[name] = RecordingRegressor(name)
            return regressors[name]

        return create

    monkeypatch.setattr(modeling, "LinearRegression", make_regressor("linear_regression"))
    monkeypatch.setattr(modeling, "RandomForestRegressor", make_regressor("random_forest"))
    monkeypatch.setattr(modeling.joblib, "dump", lambda _artifact, _path: None)

    start = datetime(2026, 9, 6, tzinfo=timezone.utc)
    rows = []
    for index in reversed(range(10)):
        features = {name: float(index) for name in EXPECTED_FEATURE_NAMES}
        rows.append(
            {
                "timestamp": start + timedelta(minutes=index),
                "features": features,
                "co2_after_15min": float(1000 + index),
            }
        )

    report = train_and_evaluate(rows, tmp_path, min_training_rows=10)

    assert report["split"] == "time_ordered_80_20"
    assert report["train_rows"] == 8
    assert report["test_rows"] == 2
    assert set(regressors) == {"linear_regression", "random_forest"}
    for regressor in regressors.values():
        assert regressor.fit_features[:, 0].tolist() == [float(i) for i in range(8)]
        assert regressor.fit_targets.tolist() == [float(1000 + i) for i in range(8)]
        assert regressor.evaluation_features[:, 0].tolist() == [8.0, 9.0]


def test_trained_artifact_round_trips_schema_metrics_and_model_version(tmp_path):
    rows = build_training_rows(make_measurements(points=100))

    report = train_and_evaluate(
        rows,
        tmp_path,
        min_training_rows=30,
        model_version="2.4",
    )

    artifact = joblib.load(tmp_path / "model.joblib")
    metrics = json.loads((tmp_path / "training_metrics.json").read_text(encoding="utf-8"))
    prediction = Predictor(tmp_path / "model.joblib").predict(prediction_payload())

    assert artifact["feature_names"] == EXPECTED_FEATURE_NAMES
    assert artifact["model_name"] == report["selected_model"]
    assert artifact["model_version"] == "2.4"
    assert artifact["training_rows"] == report["train_rows"]
    assert artifact["test_rows"] == report["test_rows"]
    assert report["train_rows"] + report["test_rows"] == len(rows)
    assert report["train_rows"] == int(len(rows) * 0.8)
    assert metrics == report
    assert set(metrics["models"]) == {"linear_regression", "random_forest"}
    assert all(
        value >= 0
        for model_metrics in metrics["models"].values()
        for value in model_metrics.values()
    )
    assert set(prediction) == {"predicted_co2_15min", "model", "model_version"}
    assert math.isfinite(prediction["predicted_co2_15min"])
    assert prediction["predicted_co2_15min"] >= 0
    assert prediction["model"] == report["selected_model"]
    assert prediction["model_version"] == "2.4"


@pytest.mark.parametrize("model_output", [-1.0, math.nan, math.inf])
def test_predictor_rejects_negative_or_non_finite_model_output(
    tmp_path, monkeypatch, model_output: float
):
    model_path = tmp_path / "model.joblib"
    model_path.write_bytes(b"test artifact")
    artifact = {
        "model": ConstantRegressor(model_output),
        "model_name": "test_model",
        "model_version": "test-version",
        "feature_names": EXPECTED_FEATURE_NAMES,
    }
    monkeypatch.setattr(predict_module.joblib, "load", lambda _path: artifact)

    with pytest.raises(ModelUnavailableError, match="некорректный прогноз"):
        Predictor(model_path).predict(prediction_payload())


def test_predict_endpoint_returns_the_documented_forecast_contract_with_nonnegative_value(
    tmp_path, monkeypatch, ml_http_server
):
    model_path = tmp_path / "model.joblib"
    model_path.write_bytes(b"test artifact")
    artifact = {
        "model": ConstantRegressor(934.12),
        "model_name": "random_forest",
        "model_version": "1.0",
        "feature_names": EXPECTED_FEATURE_NAMES,
    }
    monkeypatch.setattr(predict_module.joblib, "load", lambda _path: artifact)
    monkeypatch.setattr(ml_app, "PREDICTOR", Predictor(model_path))

    status, content_type, body = post_json(ml_http_server, prediction_payload())

    assert status == 200
    assert content_type.startswith("application/json")
    assert set(body) == {"predicted_co2_15min", "model", "model_version"}
    assert body["predicted_co2_15min"] == 934.12
    assert math.isfinite(body["predicted_co2_15min"])
    assert body["predicted_co2_15min"] >= 0
    assert body["model"] == "random_forest"
    assert body["model_version"] == "1.0"


def test_predict_endpoint_reports_missing_model_as_503_without_a_forecast(
    tmp_path, monkeypatch, ml_http_server
):
    monkeypatch.setattr(ml_app, "PREDICTOR", Predictor(tmp_path / "missing.joblib"))

    status, content_type, body = post_json(ml_http_server, prediction_payload())

    assert status == 503
    assert content_type.startswith("application/json")
    assert body["error"]["code"] == "model_unavailable"
    assert "predicted_co2_15min" not in body


def test_predict_endpoint_rejects_incomplete_prediction_payload(
    tmp_path, monkeypatch, ml_http_server
):
    monkeypatch.setattr(ml_app, "PREDICTOR", Predictor(tmp_path / "missing.joblib"))
    payload = prediction_payload()
    payload.pop("hour")

    status, _content_type, body = post_json(ml_http_server, payload)

    assert status == 400
    assert body["error"]["code"] == "validation_error"
    assert "hour" in body["error"]["message"]
