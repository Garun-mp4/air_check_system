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
    data_source: str = 'unknown',
    horizon_minutes: int = 15,
) -> dict[str, Any]:
    if len(rows) < min_training_rows:
        raise ValueError(
            f"insufficient training rows: {len(rows)} available, {min_training_rows} required"
        )
    rows = sorted(rows, key=lambda row: row["timestamp"])
    matrix, target = rows_to_matrix(rows)
    split_index = max(1, min(len(rows) - 1, int(len(rows) * 0.8)))
    test_start = rows[split_index]['timestamp']
    # Purge training labels reaching into the test period. Ordering alone leaks future labels.
    train_indices = [i for i in range(split_index) if rows[i].get('target_timestamp', rows[i]['timestamp']) < test_start]
    if len(train_indices) < 2:
        raise ValueError('insufficient independent training rows after temporal purge')
    train_x = np.asarray([matrix[i] for i in train_indices], dtype=float)
    test_x = np.asarray(matrix[split_index:], dtype=float)
    train_y = np.asarray([target[i] for i in train_indices], dtype=float)
    test_y = np.asarray(target[split_index:], dtype=float)
    if len(test_y) == 0:
        raise ValueError("time split produced an empty test set")
    persistence = test_x[:, FEATURE_NAMES.index('current_co2')]
    baseline = {'mae': float(mean_absolute_error(test_y, persistence)), 'rmse': float(np.sqrt(mean_squared_error(test_y, persistence)))}

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
        "data_source": data_source, "schema_version": 1, "horizon_minutes": horizon_minutes,
    }
    joblib.dump(artifact, output_path / "model.joblib")
    report = {
        "trained_at": artifact["trained_at"],
        "feature_names": FEATURE_NAMES,
        "total_rows": len(rows),
        "train_rows": len(train_y),
        "test_rows": len(test_y),
        "split": "time_ordered_80_20_purged",
        "purged_rows": split_index-len(train_indices),
        "data_from": rows[0]["timestamp"].isoformat(),
        "data_to": rows[-1].get("target_timestamp", rows[-1]["timestamp"]).isoformat(),
        "train_last_target": max(rows[i].get("target_timestamp",rows[i]["timestamp"]) for i in train_indices).isoformat(),
        "test_start": test_start.isoformat(),
        "models": metrics,
        "selected_model": selected_name,
        "model_version": model_version,
        "source": data_source, "schema_version": 1, "horizon_minutes": horizon_minutes,
        "baseline": {'name': 'persistence', **baseline},
        "beats_baseline": metrics[selected_name]['rmse'] < baseline['rmse'] * 0.95,
    }
    # Export the separately evaluated linear candidate, even when the server selects RF.
    from edge_export import export_linear
    edge = export_linear(fitted['linear_regression'], test_x, output_path, data_source, horizon_minutes, model_version,
        metrics['linear_regression'], baseline, test_y)
    report['edge_candidate'] = {key: edge[key] for key in ('metrics','reference_metrics','quantization_max_error_ppm','qualified','parameter_bytes')}
    (output_path / "training_metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report

