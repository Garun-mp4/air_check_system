from __future__ import annotations

import argparse
import json
import logging
import math
import os
import random
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


LOGGER = logging.getLogger("sensor-simulator")
SCENARIOS = {"normal", "closed", "open", "surge", "ventilate", "outdoor_bad"}


@dataclass(frozen=True)
class SimulatorConfig:
    backend_url: str
    device_id: str
    interval_seconds: float
    scenario: str
    initial_co2: float
    base_temperature: float
    base_humidity: float
    random_seed: int
    retry_attempts: int
    retry_base_delay_seconds: float
    request_timeout_seconds: float
    backfill_points: int
    backfill_interval_seconds: float


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def load_config() -> SimulatorConfig:
    scenario = os.environ.get("SCENARIO", "normal").strip().lower()
    if scenario not in SCENARIOS:
        raise ValueError(f"SCENARIO must be one of: {', '.join(sorted(SCENARIOS))}")
    config = SimulatorConfig(
        backend_url=os.environ.get("BACKEND_URL", "http://localhost:3000").rstrip("/"),
        device_id=os.environ.get("DEVICE_ID", "room-01").strip() or "room-01",
        interval_seconds=_env_float("SIMULATOR_INTERVAL_SECONDS", 30),
        scenario=scenario,
        initial_co2=_env_float("INITIAL_CO2", 650),
        base_temperature=_env_float("BASE_TEMPERATURE", 23),
        base_humidity=_env_float("BASE_HUMIDITY", 45),
        random_seed=_env_int("RANDOM_SEED", 42),
        retry_attempts=_env_int("RETRY_ATTEMPTS", 4),
        retry_base_delay_seconds=_env_float("RETRY_BASE_DELAY_SECONDS", 1),
        request_timeout_seconds=_env_float("REQUEST_TIMEOUT_SECONDS", 5),
        backfill_points=_env_int("BACKFILL_POINTS", 480),
        backfill_interval_seconds=_env_float("BACKFILL_INTERVAL_SECONDS", 30),
    )
    if config.interval_seconds <= 0 or config.backfill_interval_seconds <= 0:
        raise ValueError("simulator intervals must be positive")
    if config.retry_attempts < 1 or config.backfill_points < 1:
        raise ValueError("retry attempts and backfill points must be positive")
    return config


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


class SensorSimulator:
    def __init__(self, config: SimulatorConfig) -> None:
        self.config = config
        self.co2 = config.initial_co2
        self.step = 0
        self.random = random.Random(config.random_seed)
        self.window_open = config.scenario in {"open", "ventilate"}
        self.exhaust_on = False
        self.intake_on = False
        self.applied_command_ids: list[int] = []

    def sample(self, timestamp: datetime | None = None) -> dict[str, Any]:
        timestamp = timestamp or datetime.now(timezone.utc)
        timestamp = timestamp.astimezone(timezone.utc)
        phase = self.step / 12
        self.co2 = self._next_co2(phase)
        indoor_temperature = self.config.base_temperature + math.sin(phase / 2) * 0.45 + self.random.uniform(-0.08, 0.08)
        indoor_humidity = self.config.base_humidity + math.cos(phase / 3) * 1.4 + self.random.uniform(-0.3, 0.3)
        outdoor_temperature = self.config.base_temperature - 5 + math.sin(phase / 4) * 1.2
        outdoor_humidity = 62 + math.cos(phase / 5) * 4 + self.random.uniform(-0.5, 0.5)
        outdoor_pm25 = 42 if self.config.scenario == "outdoor_bad" else 8 + math.sin(phase) * 1.5
        filtered_outdoor_pm25 = outdoor_pm25 * 0.18 if self.intake_on else outdoor_pm25
        indoor_pm25 = 5 + math.sin(phase / 2) * 0.8 + self.random.uniform(-0.25, 0.25)
        if self.intake_on:
            indoor_pm25 += max(0, filtered_outdoor_pm25 - 8) * 0.08
        window_open = self.window_open
        self.step += 1
        return {
            "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
            "indoor": {
                "co2": round(clamp(self.co2, 250, 10000), 2),
                "temperature": round(indoor_temperature, 2),
                "humidity": round(clamp(indoor_humidity, 0, 100), 2),
                "pm25": round(clamp(indoor_pm25, 0, 1000), 2),
            },
            "outdoor": {
                "temperature": round(outdoor_temperature, 2),
                "humidity": round(clamp(outdoor_humidity, 0, 100), 2),
                "pm25": round(clamp(outdoor_pm25, 0, 1000), 2),
            },
            "window_open": window_open,
        }

    def _next_co2(self, phase: float) -> float:
        noise = self.random.uniform(-2.5, 2.5)
        if self.window_open or (self.exhaust_on and self.intake_on):
            outdoor_equilibrium = 420 + math.sin(phase) * 4
            ventilation_rate = 0.16 if self.window_open else 0.08
            return self.co2 + (outdoor_equilibrium - self.co2) * ventilation_rate + noise
        if self.config.scenario == "normal":
            target = 650 + math.sin(phase / 2) * 22
            return self.co2 + (target - self.co2) * 0.18 + noise
        if self.config.scenario == "closed":
            return self.co2 + 6.5 + noise
        if self.config.scenario in {"open", "ventilate"}:
            outdoor_equilibrium = 420 + math.sin(phase) * 4
            return self.co2 + (outdoor_equilibrium - self.co2) * 0.09 + noise
        if self.config.scenario == "surge":
            return self.co2 + 24 + noise
        if self.config.scenario == "outdoor_bad":
            target = 700 + math.sin(phase / 2) * 18
            return self.co2 + (target - self.co2) * 0.14 + noise
        return self.co2


def get_pending_control_commands(config: SimulatorConfig) -> list[dict[str, Any]]:
    request = Request(
        config.backend_url + "/api/v1/controls/commands?device_id=" + config.device_id + "&limit=20",
        headers={"Accept": "application/json"},
        method="GET",
    )
    with urlopen(request, timeout=config.request_timeout_seconds) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"backend returned HTTP {response.status}")
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise RuntimeError("backend returned an invalid control command response")
    return [item for item in payload["data"] if isinstance(item, dict)]


def report_control_state(
    config: SimulatorConfig,
    simulator: SensorSimulator,
    timestamp: str,
) -> None:
    payload = {
        "device_id": config.device_id,
        "timestamp": timestamp,
        "exhaust_on": simulator.exhaust_on,
        "intake_on": simulator.intake_on,
        "window_open": simulator.window_open,
        "applied_command_ids": simulator.applied_command_ids,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        config.backend_url + "/api/v1/controls/state",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=config.request_timeout_seconds) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"backend returned HTTP {response.status}")
        response.read()
    simulator.applied_command_ids = []


def sync_controls(config: SimulatorConfig, simulator: SensorSimulator) -> None:
    commands = get_pending_control_commands(config)
    applied: list[int] = []
    for command in commands:
        target = command.get("target")
        desired_state = command.get("desired_state")
        command_id = command.get("id")
        if (
            target not in {"exhaust", "intake", "window"}
            or not isinstance(desired_state, bool)
            or not isinstance(command_id, int)
        ):
            LOGGER.warning("ignoring malformed control command: %s", command)
            continue
        if target == "exhaust":
            simulator.exhaust_on = desired_state
        elif target == "intake":
            simulator.intake_on = desired_state
        else:
            simulator.window_open = desired_state
        applied.append(command_id)
    simulator.applied_command_ids = applied


def post_measurement(config: SimulatorConfig, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        config.backend_url + "/api/v1/measurements",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(1, config.retry_attempts + 1):
        try:
            with urlopen(request, timeout=config.request_timeout_seconds) as response:
                if 200 <= response.status < 300:
                    response.read()
                    return
                raise RuntimeError(f"backend returned HTTP {response.status}")
        except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
            last_error = exc
            if attempt == config.retry_attempts:
                break
            delay = config.retry_base_delay_seconds * (2 ** (attempt - 1))
            LOGGER.warning(
                "send attempt %s/%s failed: %s; retrying in %.1fs",
                attempt,
                config.retry_attempts,
                exc,
                delay,
            )
            time.sleep(delay)
    raise RuntimeError(f"unable to send measurement after {config.retry_attempts} attempts: {last_error}")


def run_once(config: SimulatorConfig) -> dict[str, Any]:
    simulator = SensorSimulator(config)
    try:
        sync_controls(config, simulator)
    except (HTTPError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
        LOGGER.warning("control state was not synchronized before one-shot sample: %s", exc)
    payload = simulator.sample()
    post_measurement(config, payload)
    try:
        report_control_state(config, simulator, payload["timestamp"])
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        LOGGER.warning("control state was not reported after one-shot sample: %s", exc)
    LOGGER.info(
        "measurement sent: scenario=%s co2=%s window_open=%s",
        config.scenario,
        payload["indoor"]["co2"],
        payload["window_open"],
    )
    return payload


def run_live(config: SimulatorConfig, stop_event: threading.Event) -> None:
    simulator = SensorSimulator(config)
    LOGGER.info(
        "live mode started: backend=%s scenario=%s interval=%.1fs",
        config.backend_url,
        config.scenario,
        config.interval_seconds,
    )
    while not stop_event.is_set():
        try:
            sync_controls(config, simulator)
        except (HTTPError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
            LOGGER.warning("control command polling failed: %s", exc)
        payload = simulator.sample()
        try:
            post_measurement(config, payload)
            report_control_state(config, simulator, payload["timestamp"])
            LOGGER.info(
                "measurement sent: step=%s co2=%s window_open=%s exhaust_on=%s intake_on=%s",
                simulator.step,
                payload["indoor"]["co2"],
                payload["window_open"],
                simulator.exhaust_on,
                simulator.intake_on,
            )
        except (HTTPError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
            LOGGER.error("measurement or control state send failed: %s", exc)
        stop_event.wait(config.interval_seconds)


def run_backfill(config: SimulatorConfig, points: int | None = None, interval: float | None = None) -> int:
    total = points or config.backfill_points
    seconds = interval or config.backfill_interval_seconds
    simulator = SensorSimulator(config)
    end = datetime.now(timezone.utc)
    start = end - timedelta(seconds=seconds * (total - 1))
    LOGGER.info(
        "backfill mode started: points=%s interval=%.1fs scenario=%s",
        total,
        seconds,
        config.scenario,
    )
    for index in range(total):
        payload = simulator.sample(start + timedelta(seconds=index * seconds))
        post_measurement(config, payload)
        if (index + 1) % 50 == 0 or index == total - 1:
            LOGGER.info("backfill progress: %s/%s", index + 1, total)
    return total


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synthetic ESP32-compatible sensor data generator.")
    parser.add_argument("--mode", choices=("live", "backfill"), help="Override SIMULATOR_MODE.")
    parser.add_argument("--once", action="store_true", help="Send one measurement and exit.")
    parser.add_argument("--points", type=int, help="Override the backfill point count.")
    parser.add_argument("--interval", type=float, help="Override the backfill interval in seconds.")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), help="Override SCENARIO.")
    return parser.parse_args()


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = parse_args()
    try:
        config = load_config()
        if args.scenario:
            config = SimulatorConfig(**{**config.__dict__, "scenario": args.scenario})
        mode = args.mode or os.environ.get("SIMULATOR_MODE", "live").strip().lower()
        if args.once:
            run_once(config)
        elif mode == "backfill":
            run_backfill(config, args.points, args.interval)
        elif mode == "live":
            stop_event = threading.Event()
            try:
                run_live(config, stop_event)
            except KeyboardInterrupt:
                LOGGER.info("stopping simulator")
                stop_event.set()
        else:
            raise ValueError("SIMULATOR_MODE must be live or backfill")
    except (RuntimeError, ValueError) as exc:
        LOGGER.error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
