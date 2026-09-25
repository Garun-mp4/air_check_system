from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.app.runtime import ApplicationRuntime
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.devices.models import WindowMotorState


CONFIG_DIR = Path(__file__).parents[1] / "config"


class _TaskManager:
    def __init__(self) -> None:
        self.callback = None
        self.task_name = None
        self.removed = None

    def add(self, callback: object, task_name: str, sort: int = 0) -> str:
        self.callback = callback
        self.task_name = task_name
        assert sort == 10
        return task_name

    def remove(self, task_name: str) -> None:
        self.removed = task_name


class _Base:
    def __init__(self) -> None:
        self.taskMgr = _TaskManager()
        self.handlers: dict[str, object] = {}

    def accept(self, key: str, callback: object) -> None:
        self.handlers[key] = callback

    def ignore(self, key: str) -> None:
        self.handlers.pop(key, None)


class _Viewport:
    def __init__(self) -> None:
        self.snapshots = []

    def apply_device_state(self, state: object, delta_seconds: float) -> None:
        self.snapshots.append((state, delta_seconds))

    def set_simulation_speed(self, speed: float) -> None:
        self.speed = speed


class _Clock:
    def getDt(self) -> float:
        return 0.1


def test_runtime_routes_debug_keys_and_publishes_device_snapshots() -> None:
    config = load_config(CONFIG_DIR, {})
    app = Application(config)
    devices = app.device_layer
    base, viewport = _Base(), _Viewport()
    runtime = ApplicationRuntime(base, devices, viewport, app.simulation_engine, clock=_Clock())

    assert set(base.handlers) == {"o", "k", "i", "x", "v", "space", "1", "2", "3", "4", "5", "6"}
    base.handlers["o"]()
    base.handlers["i"]()
    assert devices.simulation_state.window.motor_state is WindowMotorState.OPENING
    assert devices.presentation_state.intake.enabled

    task = SimpleNamespace(cont="continue")
    assert runtime._update(task) == "continue"
    snapshot, delta = viewport.snapshots[-1]
    assert delta == 0.1
    assert snapshot.window.actual_position_percent > 0
    assert snapshot.intake.enabled

    base.handlers["k"]()
    assert devices.simulation_state.window.motor_state is WindowMotorState.CLOSING
    base.handlers["x"]()
    assert devices.presentation_state.exhaust.enabled
    base.handlers["2"]()
    assert app.state.simulation_speed == 2
    assert viewport.speed == 2
    base.handlers["space"]()
    assert app.state.simulation_speed == 0
    base.handlers["space"]()
    assert app.state.simulation_speed == 2
    base.handlers["v"]()
    assert not app.state.ventilation.filter_enabled

    runtime.close()
    assert not base.handlers
    assert base.taskMgr.removed == "aircheck-device-runtime"
