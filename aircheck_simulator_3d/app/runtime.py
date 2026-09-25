from __future__ import annotations

import math
from typing import Any

from aircheck_simulator_3d.devices.device_layer import DeviceLayer


class ApplicationRuntime:
    """Application-level bridge that advances devices then publishes their view snapshot."""

    def __init__(self, base: Any, devices: DeviceLayer, viewport: Any, clock: Any | None = None) -> None:
        self._base = base
        self._devices = devices
        self._viewport = viewport
        if clock is None:
            from panda3d.core import ClockObject

            clock = ClockObject.getGlobalClock()
        self._clock = clock
        self._closed = False
        self._events: list[str] = []
        for key, callback in (
            ("o", devices.request_window_open),
            ("k", devices.request_window_close),
            ("1", devices.toggle_intake),
            ("2", devices.toggle_exhaust),
        ):
            base.accept(key, callback)
            self._events.append(key)
        self._task = base.taskMgr.add(self._update, "aircheck-device-runtime", sort=10)
        viewport.apply_device_state(devices.presentation_state, 0.0)

    def _update(self, task: Any) -> Any:
        raw_delta = float(self._clock.getDt())
        delta_seconds = min(max(raw_delta, 0.0), 0.1) if math.isfinite(raw_delta) else 0.0
        self._devices.advance(delta_seconds)
        self._viewport.apply_device_state(self._devices.presentation_state, delta_seconds)
        return task.cont

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._base.taskMgr.remove(self._task)
        for event in self._events:
            self._base.ignore(event)
        self._events.clear()
