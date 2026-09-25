from __future__ import annotations

import math
from typing import Any

from aircheck_simulator_3d.app.config import CameraConfig


class CameraController:
    """Unconstrained editor-style fly camera with smoothed movement and framing transitions."""

    def __init__(self, base: Any, config: CameraConfig) -> None:
        from panda3d.core import Point3, Vec3

        self._base = base
        self._config = config
        self._keys: set[str] = set()
        self._velocity = Vec3(0, 0, 0)
        self._wheel_remaining = 0.0
        self._looking = False
        self._paused = False
        self._transition_elapsed = 0.0
        self._transition_start_pos = Point3(0, 0, 0)
        self._transition_end_pos = Point3(0, 0, 0)
        self._transition_start_hpr = base.camera.getHpr(base.render)
        self._transition_end_hpr = base.camera.getHpr(base.render)
        self._transition_active = False
        base.disableMouse()
        base.camLens.setFov(config.field_of_view_degrees)
        base.camLens.setNearFar(config.near_plane_m, config.far_plane_m)
        self.reset(animate=False)

    @property
    def looking(self) -> bool:
        return self._looking

    def set_key(self, key: str, pressed: bool) -> None:
        if pressed:
            self._keys.add(key)
            self._transition_active = False
        else:
            self._keys.discard(key)

    def set_paused(self, paused: bool) -> None:
        self._paused = paused
        if paused:
            self._keys.clear()
            self._wheel_remaining = 0.0
            self.set_looking(False)

    def set_looking(self, looking: bool) -> None:
        if self._looking == looking:
            return
        self._looking = looking and not self._paused
        from panda3d.core import WindowProperties

        properties = WindowProperties()
        properties.setCursorHidden(self._looking)
        self._base.win.requestProperties(properties)
        if self._looking:
            self._center_pointer()

    def add_wheel_step(self, direction: int) -> None:
        if not self._paused:
            self._wheel_remaining += direction * self._config.wheel_step_m
            self._transition_active = False

    def reset(self, animate: bool = True) -> None:
        from panda3d.core import Point3

        self._keys.clear()
        self._velocity = self._velocity * 0
        self._wheel_remaining = 0.0
        target_pos = Point3(*self._config.start_position)
        target = Point3(*self._config.start_target)
        if animate:
            self._begin_transition(target_pos, target)
        else:
            self._base.camera.setPos(self._base.render, target_pos)
            self._base.camera.lookAt(self._base.render, target)
            self._transition_active = False

    def focus(self, point: tuple[float, float, float]) -> None:
        from panda3d.core import Point3, Vec3

        focus_point = Point3(*point)
        camera_position = self._base.camera.getPos(self._base.render)
        offset = Vec3(camera_position - focus_point)
        if offset.lengthSquared() < 0.01:
            offset = -self._base.camera.getQuat(self._base.render).getForward()
        distance = max(offset.length(), self._config.focus_distance_min_m)
        offset.normalize()
        self._begin_transition(focus_point + offset * distance, focus_point)

    def update(self, dt: float) -> None:
        if self._paused:
            return
        dt = min(max(dt, 0.0), 0.1)
        if self._looking:
            self._apply_mouse_delta()
        if self._transition_active:
            self._update_transition(dt)
            return

        self._apply_keyboard_motion(dt)
        self._apply_wheel_motion(dt)

    def on_window_resize(self) -> None:
        if self._looking:
            self._center_pointer()

    def close(self) -> None:
        if self._looking:
            self.set_looking(False)

    def _begin_transition(self, position: Any, look_at: Any) -> None:
        camera = self._base.camera
        self._transition_start_pos = camera.getPos(self._base.render)
        self._transition_start_hpr = camera.getHpr(self._base.render)
        camera.lookAt(self._base.render, look_at)
        self._transition_end_hpr = camera.getHpr(self._base.render)
        camera.setHpr(self._base.render, self._transition_start_hpr)
        self._transition_end_pos = position
        self._transition_elapsed = 0.0
        self._transition_active = True

    def _update_transition(self, dt: float) -> None:
        duration = self._config.transition_seconds
        self._transition_elapsed = min(self._transition_elapsed + dt, duration)
        linear = self._transition_elapsed / duration
        amount = linear * linear * (3 - 2 * linear)
        self._base.camera.setPos(
            self._base.render,
            self._transition_start_pos + (self._transition_end_pos - self._transition_start_pos) * amount,
        )
        start_h, start_p, start_r = self._transition_start_hpr
        end_h, end_p, end_r = self._transition_end_hpr
        self._base.camera.setHpr(
            self._base.render,
            _lerp_angle(start_h, end_h, amount),
            start_p + (end_p - start_p) * amount,
            start_r + (end_r - start_r) * amount,
        )
        if linear >= 1:
            self._transition_active = False

    def _apply_keyboard_motion(self, dt: float) -> None:
        from panda3d.core import Vec3

        forward_axis = float("w" in self._keys) - float("s" in self._keys)
        side_axis = float("d" in self._keys) - float("a" in self._keys)
        vertical_axis = float("e" in self._keys) - float("q" in self._keys)
        direction = Vec3(0, 0, 0)
        orientation = self._base.camera.getQuat(self._base.render)
        if forward_axis:
            direction += orientation.getForward() * forward_axis
        if side_axis:
            direction += orientation.getRight() * side_axis
        if vertical_axis:
            direction += Vec3(0, 0, vertical_axis)
        if direction.lengthSquared() > 0:
            direction.normalize()
        speed = self._config.move_speed_m_s
        if "shift" in self._keys:
            speed *= self._config.fast_move_multiplier
        desired_velocity = direction * speed
        blend = 1 - math.exp(-self._config.acceleration * dt)
        self._velocity += (desired_velocity - self._velocity) * blend
        if self._velocity.lengthSquared() > 1e-8:
            self._base.camera.setPos(
                self._base.render,
                self._base.camera.getPos(self._base.render) + self._velocity * dt,
            )

    def _apply_wheel_motion(self, dt: float) -> None:
        if abs(self._wheel_remaining) < 0.002:
            self._wheel_remaining = 0.0
            return
        amount = 1 - math.exp(-12 * dt)
        distance = self._wheel_remaining * amount
        self._wheel_remaining -= distance
        forward = self._base.camera.getQuat(self._base.render).getForward()
        self._base.camera.setPos(self._base.render, self._base.camera.getPos(self._base.render) + forward * distance)

    def _apply_mouse_delta(self) -> None:
        from panda3d.core import WindowProperties

        pointer = self._base.win.getPointer(0)
        width = max(self._base.win.getXSize(), 1)
        height = max(self._base.win.getYSize(), 1)
        center_x, center_y = width // 2, height // 2
        delta_x = pointer.getX() - center_x
        delta_y = center_y - pointer.getY()
        if delta_x or delta_y:
            sensitivity = self._config.mouse_sensitivity / min(width, height)
            h, p, r = self._base.camera.getHpr(self._base.render)
            p = min(self._config.max_pitch_degrees, max(self._config.min_pitch_degrees, p + delta_y * sensitivity))
            self._base.camera.setHpr(self._base.render, h - delta_x * sensitivity, p, r)
            self._transition_active = False
        self._base.win.movePointer(0, center_x, center_y)

    def _center_pointer(self) -> None:
        width = max(self._base.win.getXSize(), 1)
        height = max(self._base.win.getYSize(), 1)
        self._base.win.movePointer(0, width // 2, height // 2)


def _lerp_angle(start: float, end: float, amount: float) -> float:
    delta = (end - start + 180) % 360 - 180
    return start + delta * amount
