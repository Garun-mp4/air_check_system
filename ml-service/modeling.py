from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error

from feature_schema import FEATURE_NAMES, rows_to_matrix


def train_and_evaluate(
    rows: list[dict[str, Any]],
    output_dir: str | Path,
    min_training_rows: int = 30,
    model_version: str = "1.0",
) -> dict[str, Any]:
    if len(rows) < min_training_rows:
        raise ValueError(
            f"insufficient training rows: {len(rows)} available, {min_training_rows} required"
        )
    rows = sorted(rows, key=lambda row: row["timestamp"])
    matrix, target = rows_to_matrix(rows)
    split_index = max(1, min(len(rows) - 1, int(len(rows) * 0.8)))
    train_x = np.asarray(matrix[:split_index], dtype=float)
    test_x = np.asarray(matrix[split_index:], dtype=float)
    train_y = np.asarray(target[:split_index], dtype=float)
    test_y = np.asarray(target[split_index:], dtype=float)
    if len(test_y) == 0:
        raise ValueError("time split produced an empty test set")

    candidates = {
        "linear_regression": LinearRegression(),
        "random_forest": RandomForestRegressor(
            n_estimators=200,
            max_depth=12,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1,
        ),
    }
    metrics: dict[str, dict[str, float]] = {}
    fitted: dict[str, Any] = {}
    for name, model in candidates.items():
        model.fit(train_x, train_y)
        prediction = model.predict(test_x)
        metrics[name] = {
            "mae": float(mean_absolute_error(test_y, prediction)),
            "rmse": float(np.sqrt(mean_squared_error(test_y, prediction))),
        }
        fitted[name] = model

    selected_name = min(
        metrics,
        key=lambda name: (metrics[name]["rmse"], metrics[name]["mae"]),
    )
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    artifact = {
        "model": fitted[selected_name],
        "model_name": selected_name,
        "model_version": model_version,
        "feature_names": FEATURE_NAMES,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "training_rows": len(train_y),
        "test_rows": len(test_y),
    }
    joblib.dump(artifact, output_path / "model.joblib")
    report = {
        "trained_at": artifact["trained_at"],
        "feature_names": FEATURE_NAMES,
        "total_rows": len(rows),
        "train_rows": len(train_y),
        "test_rows": len(test_y),
        "split": "time_ordered_80_20",
        "models": metrics,
        "selected_model": selected_name,
        "model_version": model_version,
    }
    (output_path / "training_metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report

