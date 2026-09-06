from __future__ import annotations

import math
import threading
from pathlib import Path
from typing import Any

import joblib

from feature_schema import FEATURE_NAMES, feature_row_from_prediction_payload


class ModelUnavailableError(RuntimeError):
    pass


class Predictor:
    def __init__(self, model_path: str | Path, default_model_version: str = "1.0") -> None:
        self.model_path = Path(model_path)
        self.default_model_version = default_model_version
        self._artifact: dict[str, Any] | None = None
        self._loaded_mtime_ns: int | None = None
        self._lock = threading.Lock()

    def _load_if_needed(self) -> dict[str, Any]:
        try:
            mtime_ns = self.model_path.stat().st_mtime_ns
        except FileNotFoundError as exc:
            raise ModelUnavailableError(
                "Прогноз пока недоступен: модель ещё не обучена"
            ) from exc
        with self._lock:
            if self._artifact is None or self._loaded_mtime_ns != mtime_ns:
                artifact = joblib.load(self.model_path)
                if not isinstance(artifact, dict) or "model" not in artifact:
                    raise ModelUnavailableError("Сохранённая модель имеет неверный формат")
                if artifact.get("feature_names") != FEATURE_NAMES:
                    raise ModelUnavailableError("Сохранённая модель использует другую схему признаков")
                self._artifact = artifact
                self._loaded_mtime_ns = mtime_ns
            return self._artifact

    def predict(self, payload: dict[str, Any]) -> dict[str, Any]:
        features = feature_row_from_prediction_payload(payload)
        artifact = self._load_if_needed()
        result = artifact["model"].predict([features])
        value = float(result[0])
        if not math.isfinite(value) or value < 0:
            raise ModelUnavailableError("Модель вернула некорректный прогноз")
        return {
            "predicted_co2_15min": round(value, 2),
            "model": str(artifact.get("model_name", "unknown")),
            "model_version": str(
                artifact.get("model_version", self.default_model_version)
            ),
        }

    def info(self) -> dict[str, Any]:
        try:
            artifact = self._load_if_needed()
        except ModelUnavailableError as exc:
            return {"status": "unavailable", "message": str(exc)}
        return {
            "status": "ready",
            "model": artifact.get("model_name"),
            "model_version": artifact.get("model_version", self.default_model_version),
            "feature_names": FEATURE_NAMES,
        }

