from __future__ import annotations

import asyncio
import json
import multiprocessing
import threading
import time
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

import httpx
import pytest
from fastapi import HTTPException

from aircheck_simulator_3d.app.config import BackendConfig, load_config
from aircheck_simulator_3d.app.coordinator import SimulationCoordinator
from aircheck_simulator_3d.networking.contracts import BackendForecast, ControlStateReport, MeasurementPayload
from aircheck_simulator_3d.networking.http_backend import BackendHttpError, BackendTransportError, HttpAirCheckBackend
from aircheck_simulator_3d.networking.process_lease import SimulatorLeaseError, SimulatorProcessLease
from aircheck_simulator_3d.networking.web_service import create_web_service
from aircheck_simulator_3d.networking.workers import NetworkIntegration, TelemetryAccepted


CONFIG_DIR = Path(__file__).parents[1] / "config"
SERVICE_TOKEN = "test-only-internal-token-with-at-least-32-bytes"
DEVICE_TOKEN = "test-only-device-token-with-at-least-32-bytes"


def _config(**changes: object) -> BackendConfig:
    backend = load_config(CONFIG_DIR, {}).backend
    values = {
        "telemetry_interval_seconds": 0.04,
        "request_timeout_seconds": 0.2,
        "retry_attempts": 3,
        "retry_base_delay_seconds": 0.01,
        "command_poll_interval_seconds": 0.02,
        "health_check_interval_seconds": 0.03,
    }
    values.update(changes)
    return replace(backend, **values)


def _measurement() -> MeasurementPayload:
    return MeasurementPayload(
        "2026-09-25T10:00:00Z",
        {"co2": 720.0, "temperature": 23.4, "humidity": 45.0, "pm25": 5.2},
        {"temperature": 18.0, "humidity": 60.0, "pm25": 8.0},
        False,
    )


def _wait_for(predicate: Callable[[], bool], timeout: float = 2.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return bool(predicate())


class _JsonResponse:
    status = 201

    def __enter__(self) -> _JsonResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return b'{"data":{"prediction":null}}'


class _CoordinatorNetwork:
    def __init__(self, config: Any) -> None:
        self.config = config.backend
        self.device_id = config.devices.device_id
        self.running = False

    def start(self) -> None:
        self.running = True

    def close(self) -> None:
        self.running = False

    def publish_actual_state(self, _report: object) -> None:
        return None

    def publish_telemetry(self, _payload: object) -> None:
        return None

    def acknowledge(self, _report: object) -> None:
        return None

    def set_demo_offline(self, _offline: bool) -> None:
        return None

    def drain_events(self) -> list[object]:
        return []


def test_rest_adapter_emits_the_exact_measurement_payload_and_device_token(monkeypatch: pytest.MonkeyPatch) -> None:
    import aircheck_simulator_3d.networking.http_backend as http_backend_module

    requests: list[tuple[Any, float]] = []

    def fake_urlopen(request: Any, *, timeout: float) -> _JsonResponse:
        requests.append((request, timeout))
        return _JsonResponse()

    monkeypatch.setattr(http_backend_module, "urlopen", fake_urlopen)
    backend = HttpAirCheckBackend(
        _config(backend_url="https://api.example.test/", device_token=DEVICE_TOKEN),
        "room-01",
    )

    assert backend.send_measurement(_measurement()) is None
    report = ControlStateReport(
        "room-01",
        "2026-09-25T10:00:01Z",
        True,
        False,
        False,
        (73, 74),
    )
    backend.report_control_state(report)

    assert len(requests) == 2
    measurement_request, timeout = requests[0]
    assert measurement_request.get_method() == "POST"
    assert measurement_request.full_url == "https://api.example.test/api/v1/measurements"
    assert measurement_request.get_header("Authorization") == f"Bearer {DEVICE_TOKEN}"
    assert measurement_request.get_header("Content-type") == "application/json"
    assert timeout == 0.2
    assert json.loads(measurement_request.data.decode("utf-8")) == {
        "timestamp": "2026-09-25T10:00:00Z",
        "indoor": {"co2": 720.0, "temperature": 23.4, "humidity": 45.0, "pm25": 5.2},
        "outdoor": {"temperature": 18.0, "humidity": 60.0, "pm25": 8.0},
        "window_open": False,
    }
    control_request, control_timeout = requests[1]
    assert control_request.get_method() == "POST"
    assert control_request.full_url == "https://api.example.test/api/v1/controls/state"
    assert control_request.get_header("Authorization") == f"Bearer {DEVICE_TOKEN}"
    assert json.loads(control_request.data.decode("utf-8")) == {
        "device_id": "room-01",
        "timestamp": "2026-09-25T10:00:01Z",
        "exhaust_on": True,
        "intake_on": False,
        "window_open": False,
        "applied_command_ids": [73, 74],
    }
    assert control_timeout == 0.2


class _RetryBackend:
    def __init__(self, failure: BackendHttpError | None) -> None:
        self.failure = failure
        self.attempts = 0
        self.attempted = threading.Event()

    def latest_snapshot(self) -> BackendForecast | None:
        return BackendForecast.from_mapping(None)

    def pending_commands(self) -> list[object]:
        return []

    def send_measurement(self, _payload: MeasurementPayload) -> BackendForecast | None:
        self.attempts += 1
        self.attempted.set()
        if self.failure is not None:
            failure, self.failure = self.failure, None
            raise failure
        return BackendForecast.from_mapping(None)

    def report_control_state(self, _report: object) -> None:
        return None


@pytest.mark.parametrize(
    ("status_code", "expected_attempts", "accepted"),
    [(503, 2, True), (400, 1, False)],
)
def test_worker_retries_only_retryable_http_failures(
    status_code: int,
    expected_attempts: int,
    accepted: bool,
) -> None:
    backend = _RetryBackend(BackendHttpError(status_code, "test failure"))
    network = NetworkIntegration(_config(), "room-01", backend)  # type: ignore[arg-type]
    network.start()
    network.publish_telemetry(_measurement())

    try:
        assert backend.attempted.wait(timeout=1.0)
        if accepted:
            assert _wait_for(lambda: any(isinstance(event, TelemetryAccepted) for event in network.drain_events()))
        else:
            assert _wait_for(lambda: backend.attempts == expected_attempts)
            time.sleep(0.04)
        assert backend.attempts == expected_attempts
    finally:
        network.close()
    assert not network.running


def test_worker_shutdown_interrupts_retry_backoff_and_prevents_restart() -> None:
    class FailingBackend(_RetryBackend):
        def send_measurement(self, _payload: MeasurementPayload) -> BackendForecast | None:
            self.attempts += 1
            self.attempted.set()
            raise BackendTransportError("temporary failure")

    backend = FailingBackend(None)
    network = NetworkIntegration(
        _config(retry_attempts=5, retry_base_delay_seconds=0.5),
        "room-01",
        backend,  # type: ignore[arg-type]
    )
    network.start()
    network.publish_telemetry(_measurement())
    assert backend.attempted.wait(timeout=1.0)

    started = time.monotonic()
    network.close()

    assert time.monotonic() - started < 0.5
    assert backend.attempts == 1
    assert not network.running
    with pytest.raises(RuntimeError, match="closed"):
        network.start()


def test_simulation_ticks_continue_while_backend_health_probe_is_offline() -> None:
    class OfflineBackend:
        health_checks = 0

        def latest_snapshot(self) -> BackendForecast | None:
            self.health_checks += 1
            raise BackendTransportError("test backend offline")

        def pending_commands(self) -> list[object]:
            return []

        def send_measurement(self, _payload: MeasurementPayload) -> BackendForecast | None:
            return None

        def report_control_state(self, _report: object) -> None:
            return None

    config = load_config(CONFIG_DIR, {})
    backend = OfflineBackend()
    network = NetworkIntegration(_config(), config.devices.device_id, backend)  # type: ignore[arg-type]
    coordinator = SimulationCoordinator(config, network)
    coordinator.start()

    try:
        assert _wait_for(lambda: backend.health_checks > 0)
        assert _wait_for(lambda: coordinator.snapshot()[1]["backend"]["online"] is False)
        offline_revision, _ = coordinator.snapshot()
        assert _wait_for(lambda: coordinator.snapshot()[0] >= offline_revision + 2)
    finally:
        coordinator.close()
    assert not coordinator.running
    assert not network.running


def _competing_lease_attempt(directory: str, device_id: str, results: Any) -> None:
    lease = SimulatorProcessLease(directory, device_id)
    try:
        lease.acquire()
    except SimulatorLeaseError:
        results.put("conflict")
    else:
        results.put("acquired")
        lease.release()


def test_lease_conflict_is_enforced_across_processes_for_one_device(tmp_path: Path) -> None:
    owner = SimulatorProcessLease(str(tmp_path), "room-01")
    owner.acquire()
    context = multiprocessing.get_context("spawn")
    results = context.Queue()
    contender = context.Process(target=_competing_lease_attempt, args=(str(tmp_path), "room-01", results))

    try:
        contender.start()
        assert results.get(timeout=5.0) == "conflict"
        contender.join(timeout=5.0)
        assert contender.exitcode == 0
    finally:
        if contender.is_alive():
            contender.terminate()
            contender.join(timeout=2.0)
        owner.release()
        results.close()
        results.join_thread()


class _SnapshotCoordinator:
    config = SimpleNamespace(physics=SimpleNamespace(fixed_step_seconds=0.001))

    def __init__(self) -> None:
        self.snapshots = [
            (4, {"schema_version": 1, "sequence": "first"}),
            (8, {"schema_version": 1, "sequence": "second"}),
            (8, {"schema_version": 1, "sequence": "second"}),
        ]

    def snapshot(self) -> tuple[int, dict[str, object]]:
        if len(self.snapshots) > 1:
            return self.snapshots.pop(0)
        return self.snapshots[0]


def test_sse_stream_preserves_snapshot_shape_and_emits_only_increasing_revisions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SIMULATOR_INTERNAL_TOKEN", SERVICE_TOKEN)
    coordinator = _SnapshotCoordinator()
    app = create_web_service(coordinator)  # type: ignore[arg-type]
    events_route = next(route for route in app.routes if getattr(route, "path", None) == "/v1/events")

    class DisconnectAfterThreeSnapshots:
        calls = 0

        async def is_disconnected(self) -> bool:
            self.calls += 1
            return self.calls > 3

    async def collect_events() -> list[bytes]:
        response = await events_route.endpoint(DisconnectAfterThreeSnapshots(), f"Bearer {SERVICE_TOKEN}")
        return [chunk async for chunk in response.body_iterator]

    async def read_unauthorized_event_stream() -> None:
        with pytest.raises(HTTPException) as error:
            await events_route.endpoint(DisconnectAfterThreeSnapshots(), "Bearer wrong-service-token")
        assert error.value.status_code == 401

    chunks = asyncio.run(collect_events())
    events = [chunk.decode("utf-8") for chunk in chunks]
    asyncio.run(read_unauthorized_event_stream())

    assert len(events) == 2
    assert events[0].startswith("id: 4\nevent: snapshot\ndata: ")
    assert events[1].startswith("id: 8\nevent: snapshot\ndata: ")
    assert events[0].endswith("\n\n") and events[1].endswith("\n\n")
    assert json.loads(events[0].split("data: ", maxsplit=1)[1]) == {
        "schema_version": 1,
        "sequence": "first",
    }
    assert json.loads(events[1].split("data: ", maxsplit=1)[1]) == {
        "schema_version": 1,
        "sequence": "second",
    }


@pytest.mark.parametrize(
    "authorization",
    [None, "Basic invalid", f"Bearer {'x' * len(SERVICE_TOKEN)}", f"Bearer {SERVICE_TOKEN} extra"],
)
def test_internal_api_rejects_missing_or_malformed_service_token(
    authorization: str | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SIMULATOR_INTERNAL_TOKEN", SERVICE_TOKEN)
    app = create_web_service(_SnapshotCoordinator())  # type: ignore[arg-type]
    state_route = next(route for route in app.routes if getattr(route, "path", None) == "/v1/state")

    async def request_state() -> None:
        with pytest.raises(HTTPException) as error:
            await state_route.endpoint(authorization)
        assert error.value.status_code == 401

    asyncio.run(request_state())


@pytest.mark.parametrize(
    ("body", "expected_status"),
    [
        ([], 400),
        ({"action": "scenario", "payload": []}, 400),
        ({"action": "debug_set", "payload": {"key": "occupancy", "value": True}}, 422),
        ({"action": "debug_set", "payload": {"key": "unconfigured", "value": 1}}, 422),
        ({"action": "scenario", "payload": {"scenario_id": "missing"}}, 422),
    ],
)
def test_internal_action_api_rejects_invalid_shapes_and_unknown_controls(
    body: object,
    expected_status: int,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("SIMULATOR_INTERNAL_TOKEN", SERVICE_TOKEN)
    monkeypatch.setenv("SIMULATOR_LOCK_DIRECTORY", str(tmp_path))
    config = load_config(CONFIG_DIR, {})
    app = create_web_service(SimulationCoordinator(config, _CoordinatorNetwork(config)))  # type: ignore[arg-type]

    async def exercise() -> None:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post(
                    "/v1/actions",
                    headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
                    json=body,
                )
                assert response.status_code == expected_status

    asyncio.run(exercise())


def test_internal_action_api_requires_the_service_token_for_debug_controls(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("SIMULATOR_INTERNAL_TOKEN", SERVICE_TOKEN)
    monkeypatch.setenv("SIMULATOR_LOCK_DIRECTORY", str(tmp_path))
    config = load_config(CONFIG_DIR, {})
    app = create_web_service(SimulationCoordinator(config, _CoordinatorNetwork(config)))  # type: ignore[arg-type]

    async def exercise() -> None:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                rejected = await client.post(
                    "/v1/actions",
                    headers={"Authorization": "Bearer wrong-service-token"},
                    json={"action": "debug_set", "payload": {"key": "occupancy", "value": 6}},
                )
                assert rejected.status_code == 401

                accepted = await client.post(
                    "/v1/actions",
                    headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
                    json={"action": "debug_set", "payload": {"key": "occupancy", "value": 6}},
                )
                assert accepted.status_code == 200
                assert accepted.json() == {"data": {"key": "occupancy", "value": 6}}
                state = await client.get(
                    "/v1/state",
                    headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
                )
                assert state.json()["data"]["simulation"]["occupancy"] == 6

    asyncio.run(exercise())
