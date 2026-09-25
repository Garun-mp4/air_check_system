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


class _Clock:
    def getDt(self) -> float:
        return 0.1


def test_runtime_routes_debug_keys_and_publishes_device_snapshots() -> None:
    config = load_config(CONFIG_DIR, {})
    app = Application(config)
    devices = DeviceLayer(app.state, config.devices)
    base, viewport = _Base(), _Viewport()
    runtime = ApplicationRuntime(base, devices, viewport, clock=_Clock())

    assert set(base.handlers) == {"o", "k", "1", "2"}
    base.handlers["o"]()
    base.handlers["1"]()
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
    base.handlers["2"]()
    assert devices.presentation_state.exhaust.enabled

    runtime.close()
    assert not base.handlers
    assert base.taskMgr.removed == "aircheck-device-runtime"
