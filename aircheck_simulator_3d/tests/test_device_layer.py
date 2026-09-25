from __future__ import annotations

from pathlib import Path

import pytest

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.devices.models import WindowMotorState
from aircheck_simulator_3d.presentation.device_bindings import (
    DeviceVisualBindings,
    fan_rotation_delta_degrees,
    sash_heading_degrees,
)
from aircheck_simulator_3d.scene.device_models.device_scene import DeviceScene
from aircheck_simulator_3d.scene.device_models.ventilation import FanVisualRig
from aircheck_simulator_3d.scene.device_models.window import WindowVisualRig


CONFIG_DIR = Path(__file__).parents[1] / "config"


@pytest.fixture
def device_layer() -> DeviceLayer:
    app = Application(load_config(CONFIG_DIR, {}))
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


def test_presentation_mapping_uses_actual_position_and_only_spins_enabled_fans(device_layer: DeviceLayer) -> None:
    from panda3d.core import NodePath, PandaNode

    device_layer.request_window_open()
    device_layer.advance(10)
    device_layer.toggle_intake()
    snapshot = device_layer.presentation_state
    assert sash_heading_degrees(snapshot.window, 55) == pytest.approx(-27.5)
    assert fan_rotation_delta_degrees(snapshot.intake, 0.01) == pytest.approx(72)
    assert fan_rotation_delta_degrees(snapshot.exhaust, 0.01) == 0

    scene_root = NodePath(PandaNode("scene-root"))
    window_root = scene_root.attachNewNode(PandaNode("window"))
    sash = window_root.attachNewNode(PandaNode("sash"))
    rig = WindowVisualRig(
        root=window_root,
        sash_pivot=sash,
        open_angle_degrees=55,
        actuator_rod=window_root.attachNewNode(PandaNode("link")),
        actuator_fixed_anchor=(0, 0, 0),
        actuator_moving_anchor=(0.5, 0, -0.2),
        actuator_rod_radius=0.02,
        reed_indicator=window_root.attachNewNode(PandaNode("reed-led")),
        open_limit_indicator=window_root.attachNewNode(PandaNode("open-led")),
        close_limit_indicator=window_root.attachNewNode(PandaNode("close-led")),
        motor_indicator=window_root.attachNewNode(PandaNode("motor-led")),
    )
    intake = FanVisualRig(scene_root.attachNewNode(PandaNode("intake-rotor")), scene_root.attachNewNode(PandaNode("intake-led")))
    exhaust = FanVisualRig(scene_root.attachNewNode(PandaNode("exhaust-rotor")), scene_root.attachNewNode(PandaNode("exhaust-led")))
    binding = DeviceVisualBindings(DeviceScene({}, rig, {"intake": intake, "exhaust": exhaust}))
    binding.apply(snapshot, 0.01)

    assert sash.getH() == pytest.approx(-27.5)
    assert intake.rotor.getR() == pytest.approx(72)
    assert exhaust.rotor.getR() == pytest.approx(0)


@pytest.mark.parametrize("delta", [-0.1, float("nan"), float("inf")])
def test_window_rejects_invalid_frame_delta(device_layer: DeviceLayer, delta: float) -> None:
    with pytest.raises(ValueError, match="delta time"):
        device_layer.advance(delta)
