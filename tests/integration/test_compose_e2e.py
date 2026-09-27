"""Opt-in end-to-end checks for the isolated web-demo Compose profile.

The tests never start Docker during an ordinary pytest run. Set
``AIRCHECK_RUN_COMPOSE_E2E=1`` explicitly to build and run a uniquely named
temporary Compose project with synthetic credentials and its own volumes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid

import pytest


ROOT = Path(__file__).resolve().parents[2]
RUN_E2E = os.environ.get("AIRCHECK_RUN_COMPOSE_E2E") == "1"
pytestmark = pytest.mark.skipif(
    not RUN_E2E,
    reason="Compose E2E is opt-in; set AIRCHECK_RUN_COMPOSE_E2E=1 to create an isolated test stack",
)


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _wait_for(
    predicate: Callable[[], Any],
    description: str,
    *,
    timeout: float = 60.0,
    interval: float = 0.25,
) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            result = predicate()
            if result:
                return result
        except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last_error = exc
        time.sleep(interval)
    suffix = f"; last error: {last_error}" if last_error else ""
    raise AssertionError(f"Timed out waiting for {description}{suffix}")


class IsolatedComposeStack:
    def __init__(self) -> None:
        suffix = uuid.uuid4().hex[:10]
        self.project_name = f"aircheck-e2e-{suffix}"
        self.device_id = f"e2e-{suffix}"
        self.backend_port = _free_loopback_port()
        self.simulator_port = _free_loopback_port()
        while self.simulator_port == self.backend_port:
            self.simulator_port = _free_loopback_port()
        self.device_token = secrets.token_hex(32)
        self.simulator_token = secrets.token_hex(32)
        self.temp = tempfile.TemporaryDirectory(prefix="aircheck-e2e-")
        self.temp_path = Path(self.temp.name)
        self.env_file = self.temp_path / "synthetic.env"
        self.override_file = self.temp_path / "ports-and-intervals.yml"
        self.simulator_started_at: datetime | None = None
        self.started = False

        auth_url = f"http://127.0.0.1:{self.backend_port}"
        values = {
            "POSTGRES_DB": f"aircheck_{suffix}",
            "POSTGRES_USER": "aircheck_test",
            "POSTGRES_PASSWORD": secrets.token_hex(24),
            "DEVICE_ID": self.device_id,
            "DEVICE_API_TOKEN": self.device_token,
            "SIMULATOR_INTERNAL_TOKEN": self.simulator_token,
            "BETTER_AUTH_SECRET": secrets.token_urlsafe(48),
            "BETTER_AUTH_URL": auth_url,
            "BETTER_AUTH_TRUSTED_ORIGINS": f"{auth_url},http://localhost:{self.backend_port}",
            "PORT": "3000",
            "AIR_CHECK_DOMAIN": "aircheck-e2e.invalid",
            "AIR_CHECK_PUBLIC_URL": auth_url,
            "DEVICE_HEARTBEAT_TIMEOUT_MS": "4000",
            "MIN_TRAINING_ROWS": "30",
            "AUTOMATION_ENABLED": "true",
            "AUTO_WINDOW_ENABLED": "true",
            "E2E_BACKEND_PORT": str(self.backend_port),
            "E2E_SIMULATOR_PORT": str(self.simulator_port),
        }
        self.env_file.write_text(
            "".join(f"{key}={value}\n" for key, value in values.items()),
            encoding="utf-8",
        )
        self.override_file.write_text(
            """services:
  postgres:
    ports: !override []
  ml-service:
    ports: !override []
  backend:
    ports: !override
      - target: 3000
        published: "${E2E_BACKEND_PORT}"
        host_ip: 127.0.0.1
        protocol: tcp
  web-simulator:
    ports: !override
      - target: 8090
        published: "${E2E_SIMULATOR_PORT}"
        host_ip: 127.0.0.1
        protocol: tcp
    environment:
      SIMULATOR_INTERVAL_SECONDS: "1.0"
      COMMAND_POLL_INTERVAL_SECONDS: "0.25"
      BACKEND_HEALTH_CHECK_INTERVAL_SECONDS: "0.5"
""",
            encoding="utf-8",
        )

    @property
    def backend_url(self) -> str:
        return f"http://127.0.0.1:{self.backend_port}"

    @property
    def simulator_url(self) -> str:
        return f"http://127.0.0.1:{self.simulator_port}"

    def compose(
        self,
        *args: str,
        profiles: tuple[str, ...] = ("web-demo",),
        timeout: float = 180.0,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        command = [
            "docker",
            "compose",
            "--project-name",
            self.project_name,
            "--env-file",
            str(self.env_file),
            "--file",
            str(ROOT / "docker-compose.yml"),
            "--file",
            str(self.override_file),
        ]
        for profile in profiles:
            command.extend(("--profile", profile))
        command.extend(args)
        result = subprocess.run(
            command,
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
        if check and result.returncode != 0:
            raise AssertionError(
                f"Compose command failed ({result.returncode}): {' '.join(command[:4])} {' '.join(args)}\n"
                f"stdout:\n{result.stdout[-6000:]}\nstderr:\n{result.stderr[-6000:]}"
            )
        return result

    def cleanup(self) -> None:
        if self.started:
            result = self.compose(
                "down",
                "--volumes",
                "--remove-orphans",
                "--rmi",
                "local",
                profiles=("web-demo", "demo"),
                timeout=180.0,
                check=False,
            )
            if result.returncode != 0:
                pytest.fail(
                    f"Could not clean exact temporary Compose project {self.project_name}; "
                    f"synthetic env is retained at {self.env_file}.\n{result.stderr[-4000:]}"
                )
        self.temp.cleanup()

    def request_json(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        device_auth: bool = False,
        simulator_auth: bool = False,
        timeout: float = 5.0,
    ) -> tuple[int, dict[str, Any]]:
        status, _, raw = self.request_raw(
            method,
            path,
            body=body,
            device_auth=device_auth,
            simulator_auth=simulator_auth,
            timeout=timeout,
        )
        return status, json.loads(raw.decode("utf-8"))

    def request_raw(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        device_auth: bool = False,
        simulator_auth: bool = False,
        timeout: float = 5.0,
    ) -> tuple[int, str, bytes]:
        if path.startswith("/v1/") or path == "/healthz":
            url = self.simulator_url + path
        else:
            url = self.backend_url + path
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        if device_auth:
            headers["Authorization"] = f"Bearer {self.device_token}"
        if simulator_auth:
            headers["Authorization"] = f"Bearer {self.simulator_token}"
        request = Request(url, data=data, headers=headers, method=method)
        with urlopen(request, timeout=timeout) as response:
            return response.status, response.headers.get("Content-Type", ""), response.read()

    def seed_training_history(self) -> None:
        ending = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(minutes=1)
        for offset in range(70, 0, -1):
            timestamp = ending - timedelta(minutes=offset)
            payload = {
                "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
                "indoor": {"co2": 650, "temperature": 23, "humidity": 45, "pm25": 5},
                "outdoor": {"temperature": 18, "humidity": 60, "pm25": 8},
                "window_open": False,
            }
            status, _ = self.request_json(
                "POST", "/api/v1/measurements", body=payload, device_auth=True
            )
            assert status == 201, f"Synthetic training measurement was rejected: HTTP {status}"

    def internal_action(self, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        _, response = self.request_json(
            "POST",
            "/v1/actions",
            body={"action": action, "payload": payload or {}},
            simulator_auth=True,
        )
        return response["data"]

    def simulator_state(self) -> dict[str, Any]:
        _, response = self.request_json("GET", "/v1/state", simulator_auth=True)
        return response["data"]

    def controls(self) -> dict[str, Any]:
        _, response = self.request_json("GET", "/api/v1/controls")
        return response["data"]


@pytest.fixture(scope="session")
def e2e_stack(request: pytest.FixtureRequest) -> IsolatedComposeStack:
    try:
        engine = subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        pytest.skip(f"Docker Engine is unavailable for opt-in Compose E2E: {exc}")
    if engine.returncode != 0:
        pytest.skip(f"Docker Engine is unavailable for opt-in Compose E2E: {engine.stderr.strip()}")

    stack = IsolatedComposeStack()
    request.addfinalizer(stack.cleanup)
    stack.compose("config", "--quiet")

    # Start only backend dependencies. The test profile is uniquely named and
    # PostgreSQL/ML published ports are removed by the temporary override.
    stack.started = True
    stack.compose("up", "--detach", "--build", "backend", timeout=900)
    _wait_for(
        lambda: stack.request_json("GET", "/api/v1/measurements/latest")[1].get("data") is not None,
        "backend and its temporary PostgreSQL database",
        timeout=180,
    )
    stack.seed_training_history()
    stack.compose(
        "run",
        "--rm",
        "--no-deps",
        "ml-service",
        "python",
        "train.py",
        "--source-url",
        "http://backend:3000/api/v1/measurements/history?limit=5000",
        "--output-dir",
        "/app/model",
        "--dataset-output",
        "/tmp/aircheck-e2e-training.csv",
        "--min-rows",
        "30",
        "--timeout",
        "30",
        timeout=300,
    )

    stack.simulator_started_at = datetime.now(timezone.utc)
    stack.compose("up", "--detach", "--build", "web-simulator", timeout=900)
    _wait_for(
        lambda: stack.request_json("GET", "/healthz")[1].get("status") == "ok",
        "headless simulator health endpoint",
        timeout=120,
    )
    _wait_for(
        lambda: stack.simulator_state().get("backend", {}).get("online") is True,
        "simulator backend connection",
        timeout=45,
    )
    return stack


def test_web_demo_publishes_telemetry_and_real_ml_forecast(e2e_stack: IsolatedComposeStack) -> None:
    started_at = e2e_stack.simulator_started_at
    assert started_at is not None

    def latest_simulator_measurement() -> dict[str, Any] | None:
        _, payload = e2e_stack.request_json("GET", "/api/v1/measurements/latest")
        measurement = payload["data"]["measurement"]
        if measurement is None:
            return None
        timestamp = datetime.fromisoformat(measurement["timestamp"].replace("Z", "+00:00"))
        return measurement if timestamp >= started_at else None

    measurement = _wait_for(latest_simulator_measurement, "new telemetry from the web simulator", timeout=45)
    assert measurement["indoor"]["co2"] >= 0
    assert measurement["outdoor"]["pm25"] >= 0

    def latest_prediction() -> dict[str, Any] | None:
        _, response = e2e_stack.request_json("GET", "/api/v1/prediction/latest")
        return response.get("data")

    prediction = _wait_for(latest_prediction, "a forecast produced by the trained ML service", timeout=30)
    assert isinstance(prediction["predicted_co2_15min"], (int, float))
    assert prediction["predicted_co2_15min"] >= 0
    assert prediction["model_name"]

    snapshot = _wait_for(
        lambda: (
            current
            if (current := e2e_stack.simulator_state())["backend"]["online"] is True
            and current["backend"]["forecast"] is not None
            else None
        ),
        "simulator coordinator to consume the asynchronous backend forecast event",
        timeout=15,
    )
    assert snapshot["backend"]["forecast"]["model_name"]

    status, content_type, dashboard = e2e_stack.request_raw("GET", "/")
    assert status == 200
    # This checks the real Next.js dashboard HTTP entry point, not browser rendering.
    assert "text/html" in content_type
    assert b"AirCheck" in dashboard


def test_simulated_critical_co2_drives_actuators_and_ack(e2e_stack: IsolatedComposeStack) -> None:
    e2e_stack.internal_action("scenario", {"scenario_id": "co2_buildup"})
    e2e_stack.internal_action("debug_set", {"key": "occupancy", "value": 8})
    e2e_stack.internal_action("speed", {"speed": 60})
    peak_co2 = 0.0

    def applied_automatic_batch() -> dict[str, Any] | None:
        nonlocal peak_co2
        snapshot = e2e_stack.simulator_state()
        peak_co2 = max(peak_co2, snapshot["indoor"]["co2_ppm"])
        status = e2e_stack.controls()
        command = status.get("last_command")
        complete = (
            command is not None
            and command["source"] == "automatic"
            and command["status"] == "applied"
            and status["pending_commands"] == 0
            and status["reported"] == status["desired"]
            and status["reported"]["window_open"]
            and status["reported"]["intake_on"]
            and status["reported"]["exhaust_on"]
        )
        return status if complete else None

    status = _wait_for(
        applied_automatic_batch,
        "automatic commands to execute against actual state and be ACKed",
        timeout=120,
        interval=0.5,
    )
    snapshot = e2e_stack.simulator_state()
    assert snapshot["window"]["open_limit_switch"] is True
    assert snapshot["window"]["motor_state"] == "stopped"
    assert snapshot["ventilation"]["intake"]["enabled"] is True
    assert snapshot["ventilation"]["exhaust"]["enabled"] is True
    assert status["last_command"]["status"] == "applied"

    co2_peak_at_ack = peak_co2

    def reduced_co2() -> float | None:
        current = e2e_stack.simulator_state()["indoor"]["co2_ppm"]
        return current if current < co2_peak_at_ack - 5.0 else None

    lower_value = _wait_for(
        reduced_co2,
        "indoor CO2 to respond to the running ventilation and open window",
        timeout=30,
        interval=0.5,
    )
    assert lower_value < co2_peak_at_ack - 5.0


def test_backend_offline_and_reconnect_preserve_running_simulation(e2e_stack: IsolatedComposeStack) -> None:
    e2e_stack.compose("stop", "backend")
    last_snapshot: dict[str, Any] = {}

    def offline_snapshot() -> dict[str, Any] | None:
        snapshot = e2e_stack.simulator_state()
        last_snapshot["value"] = snapshot
        if snapshot["backend"]["online"] is False:
            return snapshot
        return None

    try:
        offline = _wait_for(
            offline_snapshot,
            "simulator offline mode after backend stop",
            timeout=60,
        )
    except AssertionError as exc:
        logs = e2e_stack.compose("logs", "--tail", "60", "web-simulator", check=False)
        containers = e2e_stack.compose("ps", check=False)
        raise AssertionError(
            f"{exc}\nlast simulator backend state: {last_snapshot.get('value', {}).get('backend')}\n"
            f"temporary Compose ps:\n{containers.stdout}\nweb-simulator logs:\n{logs.stdout[-8000:]}"
        ) from exc
    assert offline["simulation"]["elapsed_seconds"] >= 0
    assert e2e_stack.request_json("GET", "/healthz")[1]["running"] is True

    e2e_stack.compose("start", "backend")
    reconnected = _wait_for(
        lambda: (
            current
            if (current := e2e_stack.simulator_state())["backend"]["online"] is True
            else None
        ),
        "simulator reconnect after backend restart",
        timeout=45,
    )
    assert reconnected["simulation"]["elapsed_seconds"] >= offline["simulation"]["elapsed_seconds"]
    _, latest = e2e_stack.request_json("GET", "/api/v1/measurements/latest")
    assert latest["data"]["measurement"] is not None


def test_legacy_simulator_cannot_acquire_web_demo_device_lease(e2e_stack: IsolatedComposeStack) -> None:
    result = e2e_stack.compose(
        "run",
        "--rm",
        "--no-deps",
        "simulator",
        profiles=("web-demo", "demo"),
        timeout=300,
        check=False,
    )
    combined = f"{result.stdout}\n{result.stderr}".lower()
    assert result.returncode != 0, "legacy simulator unexpectedly acquired the active web-demo device lease"
    assert "already served by another simulator process" in combined
