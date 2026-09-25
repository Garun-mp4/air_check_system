from __future__ import annotations

import math
from typing import Any

from aircheck_simulator_3d.devices.presentation_state import DevicePresentationState, FanPresentationState, WindowPresentationState
from aircheck_simulator_3d.scene.device_models.device_scene import DeviceScene


def sash_heading_degrees(state: WindowPresentationState, open_angle_degrees: float) -> float:
    return -open_angle_degrees * state.actual_position_percent / 100.0


def fan_rotation_delta_degrees(state: FanPresentationState, delta_seconds: float) -> float:
    if not state.enabled or delta_seconds <= 0:
        return 0.0
    return state.rpm * 6.0 * delta_seconds


class DeviceVisualBindings:
    """Maps immutable Device Layer snapshots onto scene nodes; owns no equipment logic."""

    _ACTIVE = (0.18, 0.88, 0.54, 1)
    _INACTIVE = (0.19, 0.24, 0.25, 1)
    _OPENING = (0.94, 0.62, 0.16, 1)
    _CLOSING = (0.24, 0.68, 0.9, 1)

    def __init__(self, scene: DeviceScene) -> None:
        self._scene = scene

    def apply(self, state: DevicePresentationState, delta_seconds: float) -> None:
        from panda3d.core import Point3

        delta_seconds = validate_visual_delta(delta_seconds)
        rig = self._scene.window
        rig.sash_pivot.setH(sash_heading_degrees(state.window, rig.open_angle_degrees))
        fixed = Point3(*rig.actuator_fixed_anchor)
        moving = rig.root.getRelativePoint(
            rig.sash_pivot,
            Point3(*rig.actuator_moving_anchor),
        )
        distance = (moving - fixed).length()
        if distance > 1e-5:
            rig.actuator_rod.setPos(*fixed)
            rig.actuator_rod.lookAt(moving)
            rig.actuator_rod.setScale(rig.actuator_rod_radius, distance, rig.actuator_rod_radius)

        rig.reed_indicator.setColor(*(self._ACTIVE if state.window.reed_switch else self._INACTIVE))
        rig.open_limit_indicator.setColor(*(self._ACTIVE if state.window.open_limit_switch else self._INACTIVE))
        rig.close_limit_indicator.setColor(*(self._ACTIVE if state.window.close_limit_switch else self._INACTIVE))
        motor_color = {
            "opening": self._OPENING,
            "closing": self._CLOSING,
        }.get(state.window.motor_state, self._INACTIVE)
        rig.motor_indicator.setColor(*motor_color)

        for key, fan_state in (("intake", state.intake), ("exhaust", state.exhaust)):
            fan = self._scene.fans[key]
            rotation = fan_rotation_delta_degrees(fan_state, delta_seconds)
            if rotation:
                fan.rotor.setR((fan.rotor.getR() + rotation) % 360.0)
            fan.status_indicator.setColor(*(self._ACTIVE if fan_state.enabled else self._INACTIVE))


def validate_visual_delta(delta_seconds: float) -> float:
    if not math.isfinite(delta_seconds) or delta_seconds < 0:
        raise ValueError("presentation delta time must be finite and non-negative")
    return delta_seconds
