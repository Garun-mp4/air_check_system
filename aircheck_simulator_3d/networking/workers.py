from __future__ import annotations

import logging
import queue
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, TypeVar

from aircheck_simulator_3d.app.config import BackendConfig
from aircheck_simulator_3d.networking.contracts import (
    AirCheckBackend,
    BackendForecast,
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


LOGGER = logging.getLogger("aircheck.networking")
_T = TypeVar("_T")
_PRESERVE_FORECAST = object()


@dataclass(frozen=True)
class BackendStatusUpdate:
    online: bool
    last_seen_at: str | None
    forecast: BackendForecast | None
    message: str | None = None


@dataclass(frozen=True)
class CommandReceived:
    command: PendingControlCommand


@dataclass(frozen=True)
class AcknowledgementAccepted:
    command_ids: tuple[int, ...]


NetworkEvent = BackendStatusUpdate | CommandReceived | AcknowledgementAccepted


class TelemetrySender:
    def __init__(self, backend: AirCheckBackend) -> None:
        self._backend = backend

    def send(self, payload: MeasurementPayload) -> BackendForecast | None:
        return self._backend.send_measurement(payload)


class CommandPoller:
    def __init__(self, backend: AirCheckBackend) -> None:
        self._backend = backend

    def poll(self) -> list[PendingControlCommand]:
        return self._backend.pending_commands()


class AcknowledgementSender:
    def __init__(self, backend: AirCheckBackend) -> None:
        self._backend = backend

    def send(self, report: ControlStateReport) -> None:
        self._backend.report_control_state(report)


class BackendHealthMonitor:
    """Uses the existing latest-measurement resource as a lightweight health probe."""

    def __init__(self, backend: AirCheckBackend) -> None:
        self._backend = backend

    def check(self) -> BackendForecast | None:
        return self._backend.latest_snapshot()


class NetworkIntegration:
    """Runs all HTTP work on one managed thread and exposes immutable queue events."""

    def __init__(
        self,
        config: BackendConfig,
        device_id: str,
        backend: AirCheckBackend | None = None,
        *,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self.device_id = device_id
        self._backend = backend if backend is not None else HttpAirCheckBackend(config, device_id)
        self._telemetry_sender = TelemetrySender(self._backend)
        self._command_poller = CommandPoller(self._backend)
        self._ack_sender = AcknowledgementSender(self._backend)
        self._health_monitor = BackendHealthMonitor(self._backend)
        self._monotonic = monotonic
        self._stop = threading.Event()
        self._events: queue.SimpleQueue[NetworkEvent] = queue.SimpleQueue()
        self._ack_inbox: queue.SimpleQueue[ControlStateReport] = queue.SimpleQueue()
        self._pending_acks: deque[ControlStateReport] = deque()
        self._known_command_ids: set[int] = set()
        self._latest_lock = threading.Lock()
        self._latest_telemetry: MeasurementPayload | None = None
        self._telemetry_revision = 0
        self._latest_state: ControlStateReport | None = None
        self._forecast: BackendForecast | None = None
        self._last_seen_at: str | None = None
        self._thread: threading.Thread | None = None
        self._closed = False

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self._closed:
            raise RuntimeError("network integration is closed")
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="aircheck-network-worker",
            daemon=True,
        )
        self._thread.start()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self.config.request_timeout_seconds + 1.0)
            if self._thread.is_alive():
                LOGGER.error("network worker did not stop within the configured request timeout")

    def publish_telemetry(self, payload: MeasurementPayload) -> None:
        with self._latest_lock:
            self._latest_telemetry = payload
            self._telemetry_revision += 1

    def publish_actual_state(self, report: ControlStateReport) -> None:
        with self._latest_lock:
            self._latest_state = report

    def acknowledge(self, report: ControlStateReport) -> None:
        if report.applied_command_ids:
            self._ack_inbox.put(report)

    def drain_events(self) -> list[NetworkEvent]:
        events: list[NetworkEvent] = []
        while True:
            try:
                events.append(self._events.get_nowait())
            except queue.Empty:
                return events

    def _run(self) -> None:
        now = self._monotonic()
        next_health = now
        next_poll = now
        next_heartbeat = now
        online = False
        consecutive_health_failures = 0

        while not self._stop.is_set():
            now = self._monotonic()
            self._take_acknowledgements()

            if now >= next_health:
                try:
                    forecast = self._with_retries(self._health_monitor.check)
                    online = True
                    consecutive_health_failures = 0
                    self._set_status(True, forecast=forecast)
                    next_health = now + self.config.health_check_interval_seconds
                    next_poll = min(next_poll, now)
                except (BackendTransportError, BackendHttpError) as exc:
                    if not self._is_transient(exc):
                        online = True
                        self._set_status(True, message=str(exc))
                        next_health = now + self.config.health_check_interval_seconds
                    else:
                        online = False
                        consecutive_health_failures += 1
                        self._set_status(False, message=str(exc))
                        next_health = now + self._health_backoff_delay(consecutive_health_failures)
                except BackendProtocolError as exc:
                    online = False
                    consecutive_health_failures += 1
                    self._set_status(False, message=str(exc))
                    next_health = now + self._health_backoff_delay(consecutive_health_failures)
                except Exception:
                    LOGGER.exception("unexpected backend health check failure")
                    online = False
                    next_health = now + self.config.health_check_interval_seconds
                    self._set_status(False, message="Unexpected backend health check failure")

            if online and not self._stop.is_set():
                if self._pending_acks:
                    report = self._pending_acks[0]
                    try:
                        self._with_retries(lambda: self._ack_sender.send(report))
                    except (BackendTransportError, BackendHttpError) as exc:
                        if self._is_transient(exc):
                            online = False
                            next_health = self._monotonic() + self._connection_retry_delay()
                            self._set_status(False, message=str(exc))
                        else:
                            LOGGER.error("control-state acknowledgement rejected: %s", exc)
                            self._forget_command_ids(report.applied_command_ids)
                            self._pending_acks.popleft()
                    except BackendProtocolError as exc:
                        LOGGER.error("control-state acknowledgement response invalid: %s", exc)
                        self._forget_command_ids(report.applied_command_ids)
                        self._pending_acks.popleft()
                    except Exception:
                        LOGGER.exception("unexpected acknowledgement failure")
                        online = False
                        next_health = self._monotonic()
                        self._set_status(False, message="Unexpected acknowledgement failure")
                    else:
                        self._forget_command_ids(report.applied_command_ids)
                        self._pending_acks.popleft()
                        self._events.put(AcknowledgementAccepted(report.applied_command_ids))

                if online and now >= next_poll and not self._stop.is_set():
                    try:
                        for command in self._with_retries(self._command_poller.poll):
                            if command.command_id in self._known_command_ids:
                                continue
                            self._known_command_ids.add(command.command_id)
                            self._events.put(CommandReceived(command))
                        next_poll = self._monotonic() + self.config.command_poll_interval_seconds
                    except (BackendTransportError, BackendHttpError) as exc:
                        if self._is_transient(exc):
                            online = False
                            next_health = self._monotonic() + self._connection_retry_delay()
                            self._set_status(False, message=str(exc))
                        else:
                            LOGGER.error("command poll rejected: %s", exc)
                            next_poll = self._monotonic() + self.config.command_poll_interval_seconds
                    except BackendProtocolError as exc:
                        LOGGER.error("command response did not match the AirCheck contract: %s", exc)
                        next_poll = self._monotonic() + self.config.command_poll_interval_seconds

                telemetry = self._get_latest_telemetry()
                if online and telemetry is not None and not self._stop.is_set():
                    revision, payload = telemetry
                    try:
                        forecast = self._with_retries(lambda: self._telemetry_sender.send(payload))
                    except (BackendTransportError, BackendHttpError) as exc:
                        if self._is_transient(exc):
                            online = False
                            next_health = self._monotonic() + self._connection_retry_delay()
                            self._set_status(False, message=str(exc))
                        else:
                            LOGGER.error("telemetry rejected by backend: %s", exc)
                            self._clear_telemetry_if_current(revision)
                    except BackendProtocolError as exc:
                        LOGGER.error("measurement response did not match the AirCheck contract: %s", exc)
                        self._clear_telemetry_if_current(revision)
                    else:
                        self._clear_telemetry_if_current(revision)
                        self._set_status(True, forecast=forecast)

                if online and now >= next_heartbeat and not self._stop.is_set():
                    report = self._latest_control_state()
                    if report is not None and not self._pending_acks:
                        try:
                            self._with_retries(lambda: self._ack_sender.send(report))
                        except (BackendTransportError, BackendHttpError) as exc:
                            if self._is_transient(exc):
                                online = False
                                next_health = self._monotonic() + self._connection_retry_delay()
                                self._set_status(False, message=str(exc))
                            else:
                                LOGGER.error("actual-state heartbeat rejected: %s", exc)
                                next_heartbeat = self._monotonic() + self.config.telemetry_interval_seconds
                        except BackendProtocolError as exc:
                            LOGGER.error("actual-state heartbeat response invalid: %s", exc)
                            next_heartbeat = self._monotonic() + self.config.telemetry_interval_seconds
                        else:
                            next_heartbeat = self._monotonic() + self.config.telemetry_interval_seconds
                    else:
                        next_heartbeat = now + self.config.telemetry_interval_seconds

            wake_at = min(next_health, next_poll if online else next_health, next_heartbeat if online else next_health)
            self._stop.wait(max(0.01, min(wake_at - self._monotonic(), 0.25)))

    def _with_retries(self, operation: Callable[[], _T]) -> _T:
        last_error: Exception | None = None
        for attempt in range(1, self.config.retry_attempts + 1):
            if self._stop.is_set():
                raise BackendTransportError("network integration is shutting down")
            try:
                return operation()
            except BackendHttpError as exc:
                if not exc.retryable:
                    raise
                last_error = exc
            except BackendTransportError as exc:
                last_error = exc
            if attempt < self.config.retry_attempts:
                delay = self.config.retry_base_delay_seconds * (2 ** (attempt - 1))
                LOGGER.warning("backend request attempt %d/%d failed: %s", attempt, self.config.retry_attempts, last_error)
                if self._stop.wait(delay):
                    raise BackendTransportError("network integration stopped during retry delay")
        if isinstance(last_error, BackendHttpError):
            raise last_error
        raise BackendTransportError(
            f"request failed after {self.config.retry_attempts} attempts: {last_error}"
        ) from last_error

    def _take_acknowledgements(self) -> None:
        while True:
            try:
                report = self._ack_inbox.get_nowait()
            except queue.Empty:
                return
            known_ids = set(self._known_command_ids)
            if all(command_id in known_ids for command_id in report.applied_command_ids):
                self._pending_acks.append(report)

    def _get_latest_telemetry(self) -> tuple[int, MeasurementPayload] | None:
        with self._latest_lock:
            if self._latest_telemetry is None:
                return None
            return self._telemetry_revision, self._latest_telemetry

    def _clear_telemetry_if_current(self, revision: int) -> None:
        with self._latest_lock:
            if revision == self._telemetry_revision:
                self._latest_telemetry = None

    def _latest_control_state(self) -> ControlStateReport | None:
        with self._latest_lock:
            return self._latest_state

    def _forget_command_ids(self, command_ids: tuple[int, ...]) -> None:
        for command_id in command_ids:
            self._known_command_ids.discard(command_id)

    def _health_backoff_delay(self, failures: int) -> float:
        delay = min(self.config.retry_base_delay_seconds, self.config.health_check_interval_seconds)
        for _ in range(max(0, failures - 1)):
            if delay >= self.config.health_check_interval_seconds:
                break
            delay = min(delay * 2.0, self.config.health_check_interval_seconds)
        return delay

    def _connection_retry_delay(self) -> float:
        return min(self.config.retry_base_delay_seconds, self.config.health_check_interval_seconds)

    def _set_status(
        self,
        online: bool,
        *,
        forecast: BackendForecast | None | object = _PRESERVE_FORECAST,
        message: str | None = None,
    ) -> None:
        if forecast is not _PRESERVE_FORECAST:
            if forecast is not None and not isinstance(forecast, BackendForecast):
                raise TypeError("forecast update must be a BackendForecast or null")
            self._forecast = forecast
        if online:
            self._last_seen_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self._events.put(BackendStatusUpdate(online, self._last_seen_at, self._forecast, message))

    @staticmethod
    def _is_transient(error: BackendHttpError | BackendTransportError) -> bool:
        return not isinstance(error, BackendHttpError) or error.retryable
