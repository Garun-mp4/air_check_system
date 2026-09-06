from datetime import datetime, timedelta, timezone

import pytest

from feature_schema import build_training_rows
from modeling import train_and_evaluate
from predict import Predictor


def make_measurements(points: int = 100) -> list[dict]:
    start = datetime(2026, 9, 6, 10, 0, tzinfo=timezone.utc)
    result = []
    for index in range(points):
        result.append(
            {
                "id": index + 1,
                "timestamp": (start + timedelta(seconds=30 * index)).isoformat(),
                "indoor": {
                    "co2": 580 + index * 3.5,
                    "temperature": 22.5 + (index % 4) * 0.1,
                    "humidity": 42 + index % 5,
                    "pm25": 3 + index % 2,
                },
                "outdoor": {
                    "temperature": 16 + (index % 3) * 0.2,
                    "humidity": 60 + index % 4,
                    "pm25": 7,
                },
                "window_open": index > 70,
            }
        )
    return result


def test_training_evaluates_both_models_and_persists_selected_model(tmp_path):
    rows = build_training_rows(make_measurements())

    report = train_and_evaluate(rows, tmp_path, min_training_rows=30)

    assert set(report["models"]) == {"linear_regression", "random_forest"}
    assert report["selected_model"] in report["models"]
    assert (tmp_path / "model.joblib").exists()
    assert (tmp_path / "training_metrics.json").exists()


def test_predictor_loads_saved_model_and_reports_insufficient_model(tmp_path):
    predictor = Predictor(tmp_path / "missing.joblib")
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
    with pytest.raises(Exception, match="модель"):
        predictor.predict(payload)


def test_predictor_uses_the_saved_model_for_a_real_prediction(tmp_path):
    rows = build_training_rows(make_measurements())
    train_and_evaluate(rows, tmp_path, min_training_rows=30)
    predictor = Predictor(tmp_path / "model.joblib")

    result = predictor.predict(
        {
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
    )

    assert result["predicted_co2_15min"] >= 0
    assert result["model"] in {"linear_regression", "random_forest"}
    assert result["model_version"] == "1.0"
