from __future__ import annotations

from pathlib import Path

import pytest

from aircheck_simulator_3d.tests.support import new_simulation
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.devices.models import WindowMotorState


CONFIG_DIR = Path(__file__).parents[1] / "config"


@pytest.fixture
def device_layer() -> DeviceLayer:
    app = new_simulation(load_config(CONFIG_DIR, {}))
    return DeviceLayer(app.state, app.config.devices)


def test_window_moves_gradually_and_waits_for_open_limit(device_layer: DeviceLayer) -> None:
    device_layer.request_window_open()
    assert device_layer.simulation_state.window.motor_state is WindowMotorState.OPENING
    assert device_layer.simulation_state.window.actual_position_percent == 0

    device_layer.advance(5)
    state = device_layer.simulation_state.window
    assert state.actual_position_percent == pytest.approx(25)
    assert state.motor_state is WindowMotorState.OPENING
    assert state.reed_switch
    assert not state.open_limit_switch
    assert not state.close_limit_switch

    device_layer.advance(15)
    state = device_layer.simulation_state.window
    assert state.actual_position_percent == 100
    assert state.motor_state is WindowMotorState.STOPPED
    assert state.open_limit_switch
    assert not state.close_limit_switch


def test_window_closes_and_recomputes_reed_and_close_limit(device_layer: DeviceLayer) -> None:
    device_layer.request_window_open()
    device_layer.advance(20)
    device_layer.request_window_close()

    device_layer.advance(19)
    state = device_layer.simulation_state.window
    assert state.actual_position_percent == pytest.approx(5)
    assert state.motor_state is WindowMotorState.CLOSING
    assert state.reed_switch
    assert not state.close_limit_switch

    device_layer.advance(1)
    state = device_layer.simulation_state.window
    assert state.actual_position_percent == 0
    assert state.motor_state is WindowMotorState.STOPPED
    assert not state.reed_switch
    assert state.close_limit_switch


def test_window_can_reverse_while_moving(device_layer: DeviceLayer) -> None:
    device_layer.request_window_open()
    device_layer.advance(4)
    device_layer.request_window_close()
    device_layer.advance(2)

    state = device_layer.simulation_state.window
    assert state.actual_position_percent == pytest.approx(10)
    assert state.motor_state is WindowMotorState.CLOSING
    assert state.target_position_percent == 0


def test_fans_and_presentation_snapshot_follow_device_state(device_layer: DeviceLayer) -> None:
    before = device_layer.presentation_state
    assert not before.intake.enabled and before.intake.rpm == 0
    assert not before.exhaust.enabled and before.exhaust.rpm == 0

    device_layer.toggle_intake()
    device_layer.set_exhaust_enabled(True)
    active = device_layer.presentation_state
    assert active.intake.enabled and active.intake.rpm == active.exhaust.rpm
    assert active.exhaust.enabled

    device_layer.toggle_intake()
    device_layer.set_exhaust_enabled(False)
    stopped = device_layer.presentation_state
    assert not stopped.intake.enabled and stopped.intake.rpm == 0
    assert not stopped.exhaust.enabled and stopped.exhaust.rpm == 0


@pytest.mark.parametrize("delta", [-0.1, float("nan"), float("inf")])
def test_window_rejects_invalid_frame_delta(device_layer: DeviceLayer, delta: float) -> None:
    with pytest.raises(ValueError, match="delta time"):
        device_layer.advance(delta)
