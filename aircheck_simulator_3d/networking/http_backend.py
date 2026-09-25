from __future__ import annotations

import json
import logging
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from aircheck_simulator_3d.app.config import BackendConfig
from aircheck_simulator_3d.networking.contracts import (
    ApiRoutes,
    BackendForecast,
    ControlStateReport,
    MeasurementPayload,
    PendingControlCommand,
)


LOGGER = logging.getLogger("aircheck.networking.http")


class BackendTransportError(RuntimeError):
    """The API could not be reached or returned a transient server failure."""


class BackendHttpError(RuntimeError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(f"AirCheck backend returned HTTP {status_code}: {message}")
        self.status_code = status_code

    @property
    def retryable(self) -> bool:
        return self.status_code in {408, 425, 429} or self.status_code >= 500


class BackendProtocolError(RuntimeError):
    """The backend response did not match its documented JSON contract."""


class HttpAirCheckBackend:
    """HTTP adapter for the existing AirCheck REST API."""

    def __init__(self, config: BackendConfig, device_id: str) -> None:
        self.routes = ApiRoutes(config.backend_url.rstrip("/"))
        self.device_id = device_id
        self.timeout_seconds = config.request_timeout_seconds
        self.command_limit = config.command_limit

    def pending_commands(self) -> list[PendingControlCommand]:
        payload = self._request("GET", self.routes.pending_commands(self.device_id, self.command_limit))
        data = payload.get("data")
        if not isinstance(data, list):
            raise BackendProtocolError("pending commands response must contain a data array")
        commands: list[PendingControlCommand] = []
        for item in data:
            if not isinstance(item, dict):
                LOGGER.warning("ignoring malformed control command: expected object")
                continue
            try:
                commands.append(PendingControlCommand.from_mapping(item))
            except ValueError as exc:
                LOGGER.warning("ignoring malformed control command: %s", exc)
        return commands

    def send_measurement(self, payload: MeasurementPayload) -> BackendForecast | None:
        response = self._request("POST", self.routes.measurements, payload.to_mapping())
        data = response.get("data")
        if not isinstance(data, dict) or "prediction" not in data:
            raise BackendProtocolError("measurement response must contain data.prediction")
        try:
            return BackendForecast.from_mapping(data["prediction"])
        except ValueError as exc:
            raise BackendProtocolError(str(exc)) from exc

    def report_control_state(self, report: ControlStateReport) -> None:
        self._request("POST", self.routes.control_state, report.to_mapping())

    def latest_snapshot(self) -> BackendForecast | None:
        response = self._request("GET", self.routes.latest_measurement)
        data = response.get("data")
        if not isinstance(data, dict) or "prediction" not in data:
            raise BackendProtocolError("latest measurement response must contain data.prediction")
        try:
            return BackendForecast.from_mapping(data["prediction"])
        except ValueError as exc:
            raise BackendProtocolError(str(exc)) from exc

    def _request(self, method: str, url: str, payload: dict[str, object] | None = None) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                status = response.status
                raw = response.read()
        except HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise BackendHttpError(exc.code, details[:300]) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise BackendTransportError(str(exc)) from exc

        if not 200 <= status < 300:
            raise BackendHttpError(status, "unexpected non-success response")
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BackendProtocolError("backend response was not valid JSON") from exc
        if not isinstance(result, dict):
            raise BackendProtocolError("backend response must be a JSON object")
        return result
