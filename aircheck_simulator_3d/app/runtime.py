from __future__ import annotations

import math
from typing import Any

from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.simulation.engine import SimulationEngine


class ApplicationRuntime:
    """Application-level bridge that advances devices then publishes their view snapshot."""

    def __init__(
        self,
        base: Any,
        devices: DeviceLayer,
        viewport: Any,
        simulation: SimulationEngine,
        clock: Any | None = None,
    ) -> None:
        self._base = base
        self._devices = devices
        self._viewport = viewport
        self._simulation = simulation
        if clock is None:
            from panda3d.core import ClockObject

            clock = ClockObject.getGlobalClock()
        self._clock = clock
        self._closed = False
        self._events: list[str] = []
        for key, callback in (
            ("o", devices.request_window_open),
            ("k", devices.request_window_close),
            ("i", devices.toggle_intake),
            ("x", devices.toggle_exhaust),
            ("v", devices.toggle_filter),
            ("space", self._toggle_pause),
        ):
            base.accept(key, callback)
            self._events.append(key)
        for key, speed in enumerate(simulation.supported_speeds, start=1):
            event = str(key)
            base.accept(event, lambda speed=speed: self._set_speed(speed))
            self._events.append(event)
        self._task = base.taskMgr.add(self._update, "aircheck-device-runtime", sort=10)
        self._viewport.set_simulation_speed(simulation.state.simulation_speed)
        viewport.apply_device_state(devices.presentation_state, 0.0)

    def _set_speed(self, speed: float) -> None:
        self._simulation.set_speed(speed)
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)

    def _toggle_pause(self) -> None:
        self._simulation.toggle_pause()
        self._viewport.set_simulation_speed(self._simulation.state.simulation_speed)

    def _update(self, task: Any) -> Any:
        raw_delta = float(self._clock.getDt())
        delta_seconds = max(raw_delta, 0.0) if math.isfinite(raw_delta) else 0.0
        self._simulation.advance(delta_seconds)
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
