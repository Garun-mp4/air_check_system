from __future__ import annotations

from enum import StrEnum


class VisualizationMode(StrEnum):
    NORMAL = "Normal"
    AIRFLOW = "Airflow"
    SENSORS = "Sensors"
    WIRING = "Wiring"
    TECHNICAL = "Technical"


VISUALIZATION_MODES = tuple(VisualizationMode)
