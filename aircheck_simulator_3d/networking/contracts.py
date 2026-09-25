from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
import math
from typing import Mapping, Protocol
from urllib.parse import urlencode

from aircheck_simulator_3d.simulation.state import SimulationState


class CommandTarget(StrEnum):
    EXHAUST = "exhaust"
    INTAKE = "intake"
    WINDOW = "window"


@dataclass(frozen=True)
class ApiRoutes:
    backend_url: str

    @property
    def measurements(self) -> str:
        return f"{self.backend_url}/api/v1/measurements"

    @property
    def latest_measurement(self) -> str:
        return f"{self.backend_url}/api/v1/measurements/latest"

    def pending_commands(self, device_id: str, limit: int) -> str:
        query = urlencode({"device_id": device_id, "limit": limit})
        return f"{self.backend_url}/api/v1/controls/commands?{query}"

    @property
    def control_state(self) -> str:
        return f"{self.backend_url}/api/v1/controls/state"


@dataclass(frozen=True)
class PendingControlCommand:
    command_id: int
    target: CommandTarget
    desired_state: bool
    source: str | None = None
    reason: str | None = None
    batch_id: str | None = None

    @classmethod
    def from_mapping(cls, raw: Mapping[str, object]) -> PendingControlCommand:
        command_id = raw.get("id")
        target = raw.get("target")
        desired_state = raw.get("desired_state")
        if type(command_id) is not int:
            raise ValueError("control command id must be an integer")
        if not isinstance(target, str):
            raise ValueError("control command target must be a string")
        if not isinstance(desired_state, bool):
            raise ValueError("control command desired_state must be a boolean")
        try:
            parsed_target = CommandTarget(target)
        except ValueError as exc:
            raise ValueError(f"unsupported control command target: {target}") from exc
        return cls(
            command_id=command_id,
            target=parsed_target,
            desired_state=desired_state,
            source=_optional_text(raw.get("source")),
            reason=_optional_text(raw.get("reason")),
            batch_id=_optional_text(raw.get("batch_id")),
        )


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _iso_timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("API timestamps must include a timezone")
    return value.isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class MeasurementPayload:
    timestamp: str
    indoor: Mapping[str, float]
    outdoor: Mapping[str, float]
    window_open: bool

    @classmethod
    def from_state(cls, state: SimulationState, timestamp: datetime) -> MeasurementPayload:
        return cls(
            timestamp=_iso_timestamp(timestamp),
            indoor={
                "co2": state.indoor.co2_ppm,
                "temperature": state.indoor.temperature_c,
                "humidity": state.indoor.humidity_percent,
                "pm25": state.indoor.pm25_ug_m3,
            },
            outdoor={
                "temperature": state.outdoor.temperature_c,
                "humidity": state.outdoor.humidity_percent,
                "pm25": state.outdoor.pm25_ug_m3,
            },
            window_open=state.window.reed_switch,
        )

    def to_mapping(self) -> dict[str, object]:
        return {
            "timestamp": self.timestamp,
            "indoor": dict(self.indoor),
            "outdoor": dict(self.outdoor),
            "window_open": self.window_open,
        }


@dataclass(frozen=True)
class ControlStateReport:
    device_id: str
    timestamp: str
    exhaust_on: bool
    intake_on: bool
    window_open: bool
    applied_command_ids: tuple[int, ...]

    @classmethod
    def from_state(
        cls,
        device_id: str,
        timestamp: datetime,
        state: SimulationState,
        applied_command_ids: tuple[int, ...] = (),
    ) -> ControlStateReport:
        return cls(
            device_id=device_id,
            timestamp=_iso_timestamp(timestamp),
            exhaust_on=state.ventilation.exhaust.enabled,
            intake_on=state.ventilation.intake.enabled,
            window_open=state.window.reed_switch,
            applied_command_ids=applied_command_ids,
        )

    def to_mapping(self) -> dict[str, object]:
        return {
            "device_id": self.device_id,
            "timestamp": self.timestamp,
            "exhaust_on": self.exhaust_on,
            "intake_on": self.intake_on,
            "window_open": self.window_open,
            "applied_command_ids": list(self.applied_command_ids),
        }


@dataclass(frozen=True)
class BackendForecast:
    """Prediction produced and stored by the AirCheck ML service."""

    predicted_co2_15min: float
    target_time: str | None = None
    model_name: str | None = None
    model_version: str | None = None

    @classmethod
    def from_mapping(cls, raw: object) -> BackendForecast | None:
        if raw is None:
            return None
        if not isinstance(raw, Mapping):
            raise ValueError("prediction response must be an object or null")
        co2 = raw.get("predicted_co2_15min")
        if isinstance(co2, bool) or not isinstance(co2, (int, float)):
            raise ValueError("prediction must contain numeric predicted_co2_15min")
        value = float(co2)
        if not math.isfinite(value) or value < 0:
            raise ValueError("predicted CO2 must be finite and non-negative")
        return cls(
            predicted_co2_15min=value,
            target_time=_optional_text(raw.get("target_time")),
            model_name=_optional_text(raw.get("model_name")),
            model_version=_optional_text(raw.get("model_version")),
        )


class AirCheckBackend(Protocol):
    """Synchronous HTTP port; callers keep all requests off the render thread."""

    def pending_commands(self) -> list[PendingControlCommand]: ...

    def send_measurement(self, payload: MeasurementPayload) -> BackendForecast | None: ...

    def report_control_state(self, report: ControlStateReport) -> None: ...

    def latest_snapshot(self) -> BackendForecast | None: ...
