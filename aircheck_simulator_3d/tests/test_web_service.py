from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.app.coordinator import SimulationCoordinator
from aircheck_simulator_3d.networking.process_lease import SimulatorProcessLease
from aircheck_simulator_3d.networking.web_service import create_web_service


CONFIG_DIR = Path(__file__).parents[1] / "config"
SERVICE_TOKEN = "test-only-internal-token-with-at-least-32-bytes"


class _Network:
    def __init__(self, config: Any, device_id: str) -> None:
        self.config = config
        self.device_id = device_id
        self._running = False

    @property
    def running(self) -> bool:
        return self._running

    def start(self) -> None:
        self._running = True

    def close(self) -> None:
        self._running = False

    def publish_actual_state(self, _: object) -> None:
        pass

    def publish_telemetry(self, _: object) -> None:
        pass

    def acknowledge(self, _: object) -> None:
        pass

    def set_demo_offline(self, _: bool) -> None:
        pass

    def drain_events(self) -> list[object]:
        return []


def _coordinator() -> SimulationCoordinator:
    config = load_config(CONFIG_DIR, {})
    return SimulationCoordinator(config, _Network(config.backend, config.devices.device_id))  # type: ignore[arg-type]


def test_service_protects_state_and_runs_coordinator_lifecycle(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SIMULATOR_INTERNAL_TOKEN", SERVICE_TOKEN)
    monkeypatch.setenv("SIMULATOR_LOCK_DIRECTORY", str(tmp_path))
    coordinator = _coordinator()
    app = create_web_service(coordinator)

    async def exercise() -> None:
        async with app.router.lifespan_context(app):
            assert coordinator.running
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                assert (await client.get("/healthz")).json()["running"] is True
                assert (await client.get("/v1/state")).status_code == 401

                response = await client.get("/v1/state", headers={"Authorization": f"Bearer {SERVICE_TOKEN}"})
                assert response.status_code == 200
                assert response.json()["data"]["device_id"] == "room-01"

    asyncio.run(exercise())

    assert not coordinator.running
    probe = SimulatorProcessLease(str(tmp_path), "room-01")
    probe.acquire()
    probe.release()


def test_service_validates_and_dispatches_only_supported_actions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIMULATOR_INTERNAL_TOKEN", SERVICE_TOKEN)
    coordinator = _coordinator()
    app = create_web_service(coordinator)

    async def exercise() -> None:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {SERVICE_TOKEN}"}
                assert (await client.post("/v1/actions", headers=headers, json={"action": "arbitrary"})).status_code == 400
                assert (await client.post("/v1/actions", headers=headers, json={"action": "speed", "payload": {"speed": -1}})).status_code == 422

                response = await client.post(
                    "/v1/actions",
                    headers=headers,
                    json={"action": "scenario", "payload": {"scenario_id": "sensor_failure"}},
                )
                assert response.status_code == 200
                assert response.json()["data"]["scenario"] == "sensor_failure"
                snapshot = (await client.get("/v1/state", headers=headers)).json()["data"]
                indoor_sensor = next(sensor for sensor in snapshot["sensors"] if sensor["id"] == "indoor_climate")
                assert indoor_sensor["online"] is False

    asyncio.run(exercise())


def test_sse_stream_emits_versioned_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIMULATOR_INTERNAL_TOKEN", SERVICE_TOKEN)
    app = create_web_service(_coordinator())
    events_route = next(route for route in app.routes if getattr(route, "path", None) == "/v1/events")

    class _DisconnectAfterFirstEvent:
        calls = 0

        async def is_disconnected(self) -> bool:
            self.calls += 1
            return self.calls > 1

    async def read_one_event() -> bytes:
        response = await events_route.endpoint(_DisconnectAfterFirstEvent(), f"Bearer {SERVICE_TOKEN}")
        return await anext(response.body_iterator)

    event = asyncio.run(read_one_event()).decode("utf-8")
    prefix, payload = event.split("data: ", maxsplit=1)
    assert "event: snapshot" in prefix
    assert json.loads(payload)["schema_version"] == 1
