from __future__ import annotations

import asyncio
import hmac
import json
import os
from contextlib import asynccontextmanager
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any, AsyncIterator

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.app.coordinator import SimulationCoordinator
from aircheck_simulator_3d.networking.process_lease import SimulatorProcessLease


def create_web_service(coordinator: SimulationCoordinator | None = None) -> FastAPI:
    simulation = coordinator or SimulationCoordinator(load_config())
    internal_token = os.environ.get("SIMULATOR_INTERNAL_TOKEN", "").strip()
    if len(internal_token) < 32:
        raise RuntimeError("SIMULATOR_INTERNAL_TOKEN must contain at least 32 characters")

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        lease = SimulatorProcessLease(
            os.environ.get("SIMULATOR_LOCK_DIRECTORY"),
            simulation.config.devices.device_id,
        )
        lease.acquire()
        try:
            simulation.start()
            yield
        finally:
            try:
                simulation.close()
            finally:
                lease.release()

    app = FastAPI(title="AirCheck headless simulator", docs_url=None, redoc_url=None, lifespan=lifespan)

    def authorize(authorization: str | None) -> None:
        scheme, separator, token = (authorization or "").partition(" ")
        if (
            not separator
            or scheme.lower() != "bearer"
            or not hmac.compare_digest(token, internal_token)
        ):
            raise HTTPException(status_code=401, detail="Invalid simulator service token")

    @app.get("/healthz")
    async def health() -> dict[str, Any]:
        revision, snapshot = simulation.snapshot()
        return {"status": "ok", "running": simulation.running, "revision": revision, "device_id": snapshot["device_id"]}

    @app.get("/v1/state")
    async def state(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        authorize(authorization)
        _, snapshot = simulation.snapshot()
        return {"data": snapshot}

    @app.get("/v1/events")
    async def events(request: Request, authorization: str | None = Header(default=None)) -> StreamingResponse:
        authorize(authorization)

        async def stream() -> AsyncIterator[bytes]:
            last_revision = -1
            while not await request.is_disconnected():
                revision, snapshot = simulation.snapshot()
                if revision != last_revision:
                    payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
                    yield f"id: {revision}\nevent: snapshot\ndata: {payload}\n\n".encode("utf-8")
                    last_revision = revision
                await asyncio.sleep(max(0.05, simulation.config.physics.fixed_step_seconds))

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @app.post("/v1/actions")
    async def action(
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        authorize(authorization)
        try:
            body = await request.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Request body must be valid JSON") from exc
        if not isinstance(body, dict) or not isinstance(body.get("action"), str):
            raise HTTPException(status_code=400, detail="action is required")
        action_name = body["action"]
        if action_name not in {"scenario", "demo_start", "demo_stop", "pause", "speed", "debug_set"}:
            raise HTTPException(status_code=400, detail="Unsupported simulator action")
        payload = body.get("payload", {})
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="payload must be an object")
        future = simulation.dispatch(action_name, payload)
        try:
            result = await asyncio.wait_for(asyncio.wrap_future(future), timeout=3.0)
        except FutureTimeout as exc:
            future.cancel()
            raise HTTPException(status_code=503, detail="Simulation coordinator did not accept the action") from exc
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"data": result}

    app.state.simulation = simulation
    return app
