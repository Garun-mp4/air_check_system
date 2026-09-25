from __future__ import annotations

import json
import threading
import time
from dataclasses import replace
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event
from typing import Any
from urllib.parse import urlparse

import pytest

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import BackendConfig, load_config
from aircheck_simulator_3d.devices.command_executor import DeviceCommandExecutor
from aircheck_simulator_3d.networking.contracts import (
    BackendForecast,
    CommandTarget,
    ControlStateReport,
    MeasurementPayload,
    PendingControlCommand,
)
from aircheck_simulator_3d.networking.http_backend import (
    BackendHttpError,
    BackendProtocolError,
    BackendTransportError,
    HttpAirCheckBackend,
)
from aircheck_simulator_3d.networking.workers import (
    BackendStatusUpdate,
    CommandReceived,
    NetworkIntegration,
)


CONFIG_DIR = Path(__file__).parents[1] / "config"
PREDICTION = {
    "predicted_co2_15min": 910.0,
    "target_time": "2026-09-25T10:15:00Z",
    "model_name": "random_forest",
    "model_version": "1.0",
}
COMMAND = PendingControlCommand(71, CommandTarget.INTAKE, True, source="automatic")


def _payload() -> MeasurementPayload:
    return MeasurementPayload(
        "2026-09-25T10:00:00Z",
        {"co2": 720.0, "temperature": 23.4, "humidity": 45.0, "pm25": 5.2},
        {"temperature": 18.0, "humidity": 60.0, "pm25": 8.0},
        False,
    )


def _config(**changes: object) -> BackendConfig:
    base = load_config(CONFIG_DIR, {}).backend
    updates = {
        "telemetry_interval_seconds": 0.04,
        "request_timeout_seconds": 0.3,
        "retry_attempts": 1,
        "retry_base_delay_seconds": 0.01,
        "command_poll_interval_seconds": 0.02,
        "health_check_interval_seconds": 0.03,
    }
    updates.update(changes)
    return replace(base, **updates)


@pytest.fixture
def api_server():
    class Handler(BaseHTTPRequestHandler):
        requests: list[tuple[str, str, dict[str, Any] | None]] = []
        lock = threading.Lock()
        measurement_status = 201
        latest_delay_seconds = 0.0
        malformed_latest = False
        forecast: dict[str, Any] | None = dict(PREDICTION)
        commands: list[dict[str, Any]] = [
            {"id": 73, "target": "exhaust", "desired_state": True, "source": "automatic"}
        ]

        def log_message(self, _format: str, *_args: object) -> None:
            return

        def _respond(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self) -> None:
            route = urlparse(self.path)
            with self.lock:
                self.requests.append(("GET", self.path, None))
            if route.path == "/api/v1/measurements/latest":
                if self.latest_delay_seconds:
                    time.sleep(self.latest_delay_seconds)
                payload = (
                    {"unexpected": "shape"}
                    if self.malformed_latest
                    else {"data": {"measurement": None, "prediction": self.forecast}}
                )
                self._respond(200, payload)
            elif route.path == "/api/v1/controls/commands":
                self._respond(200, {"data": list(self.commands), "meta": {"count": len(self.commands)}})
            else:
                self._respond(404, {"error": {"code": "not_found"}})

        def do_POST(self) -> None:
            route = urlparse(self.path)
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            with self.lock:
                self.requests.append(("POST", self.path, payload))
            if route.path == "/api/v1/measurements":
                if self.measurement_status != 201:
                    self._respond(self.measurement_status, {"error": {"code": "validation_error"}})
                else:
                    self._respond(201, {"data": {"prediction": self.forecast}})
            elif route.path == "/api/v1/controls/state":
                for command_id in payload.get("applied_command_ids", []):
                    self.commands = [item for item in self.commands if item.get("id") != command_id]
                self._respond(200, {"data": {"device_id": payload.get("device_id")}})
            else:
                self._respond(404, {"error": {"code": "not_found"}})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", Handler
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_http_adapter_uses_existing_aircheck_paths_and_payloads(api_server) -> None:
    backend_url, handler = api_server
    backend = HttpAirCheckBackend(_config(backend_url=backend_url), "room-01")

    assert backend.latest_snapshot() == BackendForecast.from_mapping(PREDICTION)
    commands = backend.pending_commands()
    forecast = backend.send_measurement(_payload())
    report = ControlStateReport(
        "room-01", "2026-09-25T10:00:01Z", True, False, False, (73,)
    )
    backend.report_control_state(report)

    assert commands == [
        PendingControlCommand(73, CommandTarget.EXHAUST, True, source="automatic")
    ]
    assert forecast == BackendForecast.from_mapping(PREDICTION)
    requests = handler.requests
    assert any(item[1] == "/api/v1/controls/commands?device_id=room-01&limit=20" for item in requests)
    measurement = next(body for method, path, body in requests if method == "POST" and path.endswith("/measurements"))
    assert measurement == _payload().to_mapping()
    control_report = next(body for method, path, body in requests if path.endswith("/controls/state"))
    assert control_report == report.to_mapping()


def test_http_adapter_surfaces_validation_error_without_retryable_classification(api_server) -> None:
    backend_url, handler = api_server
    handler.measurement_status = 400
    backend = HttpAirCheckBackend(_config(backend_url=backend_url), "room-01")

    with pytest.raises(BackendHttpError) as error:
        backend.send_measurement(_payload())

    assert error.value.status_code == 400
    assert not error.value.retryable


def test_http_timeout_is_reported_as_transport_failure(api_server) -> None:
    backend_url, handler = api_server
    handler.latest_delay_seconds = 0.15
    backend = HttpAirCheckBackend(
        _config(backend_url=backend_url, request_timeout_seconds=0.02), "room-01"
    )

    with pytest.raises(BackendTransportError):
        backend.latest_snapshot()


def test_unexpected_success_response_shape_is_rejected(api_server) -> None:
    backend_url, handler = api_server
    handler.malformed_latest = True
    backend = HttpAirCheckBackend(_config(backend_url=backend_url), "room-01")

    with pytest.raises(BackendProtocolError, match="data.prediction"):
        backend.latest_snapshot()


class _SwitchableBackend:
    def __init__(self, *, block_telemetry: bool = False, telemetry_failures: int = 0) -> None:
        self.available = Event()
        self.block_telemetry = block_telemetry
        self.telemetry_failures = telemetry_failures
        self.telemetry_attempts = 0
        self.telemetry_entered = Event()
        self.release_telemetry = Event()
        self.measurements: list[MeasurementPayload] = []
        self.reports: list[ControlStateReport] = []
        self.pending = [COMMAND]
        self.lock = threading.Lock()

    def _require_available(self) -> None:
        if not self.available.is_set():
            raise BackendTransportError("test backend is offline")

    def latest_snapshot(self) -> BackendForecast | None:
        self._require_available()
        return BackendForecast.from_mapping(PREDICTION)

    def pending_commands(self) -> list[PendingControlCommand]:
        self._require_available()
        with self.lock:
            return list(self.pending)

    def send_measurement(self, payload: MeasurementPayload) -> BackendForecast | None:
        self._require_available()
        self.telemetry_attempts += 1
        if self.telemetry_failures:
            self.telemetry_failures -= 1
            raise BackendTransportError("temporary telemetry failure")
        self.telemetry_entered.set()
        if self.block_telemetry:
            self.release_telemetry.wait(timeout=1)
        with self.lock:
            self.measurements.append(payload)
        return BackendForecast.from_mapping(PREDICTION)

    def report_control_state(self, report: ControlStateReport) -> None:
        self._require_available()
        with self.lock:
            self.reports.append(report)
            applied = set(report.applied_command_ids)
            self.pending = [item for item in self.pending if item.command_id not in applied]


def _wait_for(predicate, timeout: float = 2.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


def test_worker_offline_reconnect_telemetry_commands_execution_and_ack() -> None:
    backend = _SwitchableBackend()
    network = NetworkIntegration(_config(), "room-01", backend)
    network.start()
    state = Application(load_config(CONFIG_DIR, {})).state
    report = ControlStateReport.from_state("room-01", datetime.now(timezone.utc), state)
    network.publish_actual_state(report)

    started = time.perf_counter()
    network.publish_telemetry(_payload())
    assert time.perf_counter() - started < 0.05
    assert _wait_for(
        lambda: any(isinstance(event, BackendStatusUpdate) and not event.online for event in network.drain_events())
    )

    backend.available.set()
    received: list[CommandReceived] = []
    statuses: list[BackendStatusUpdate] = []
    assert _wait_for(
        lambda: _collect_commands(network, received, statuses) and bool(received)
    )
    assert _wait_for(lambda: len(backend.measurements) == 1)

    active_app = Application(load_config(CONFIG_DIR, {}))
    executor = DeviceCommandExecutor(active_app.device_layer)
    for event in received:
        executor.enqueue(event.command)
    assert executor.update() == (COMMAND.command_id,)
    assert executor.active_commands == ()
    ack = ControlStateReport.from_state(
        "room-01", datetime.now(timezone.utc), active_app.state, (COMMAND.command_id,)
    )
    network.acknowledge(ack)

    assert _wait_for(lambda: any(COMMAND.command_id in item.applied_command_ids for item in backend.reports))
    network.close()
    assert not network.running
    assert backend.measurements[0].indoor["co2"] == 720
    assert any(event.online for event in statuses)


def _collect_commands(
    network: NetworkIntegration,
    found: list[CommandReceived],
    statuses: list[BackendStatusUpdate],
) -> bool:
    for event in network.drain_events():
        if isinstance(event, CommandReceived):
            found.append(event)
        elif isinstance(event, BackendStatusUpdate):
            statuses.append(event)
    return bool(found)


def test_simulation_thread_can_publish_while_worker_is_blocked_in_http_call() -> None:
    backend = _SwitchableBackend(block_telemetry=True)
    backend.available.set()
    network = NetworkIntegration(_config(), "room-01", backend)
    network.start()
    network.publish_telemetry(_payload())
    assert backend.telemetry_entered.wait(timeout=1)

    started = time.perf_counter()
    network.publish_telemetry(replace(_payload(), timestamp="2026-09-25T10:00:30Z"))
    duration = time.perf_counter() - started
    backend.release_telemetry.set()

    assert duration < 0.05
    network.close()
    assert not network.running


def test_worker_retries_temporary_request_failures() -> None:
    backend = _SwitchableBackend(telemetry_failures=2)
    backend.available.set()
    network = NetworkIntegration(_config(retry_attempts=3), "room-01", backend)
    network.start()
    network.publish_telemetry(_payload())

    try:
        assert _wait_for(lambda: len(backend.measurements) == 1)
        assert backend.telemetry_attempts == 3
    finally:
        network.close()
    assert not network.running
