from __future__ import annotations

from collections.abc import Callable
from typing import Any

from aircheck_simulator_3d.presentation.camera_controller import CameraController
from aircheck_simulator_3d.scene.cutaway import CutawayController
from aircheck_simulator_3d.scene.picking import ScenePicker


class InputController:
    """Routes window events to presentation controls; it has no simulation-core dependency."""

    def __init__(
        self,
        base: Any,
        camera: CameraController,
        picker: ScenePicker,
        cutaway: CutawayController,
        on_menu_change: Callable[[bool], None],
    ) -> None:
        self._base = base
        self._camera = camera
        self._picker = picker
        self._cutaway = cutaway
        self._on_menu_change = on_menu_change
        self.menu_open = False
        self._events: list[str] = []

        for key in ("w", "a", "s", "d", "q", "e", "shift"):
            self._accept(key, self._set_key, [key, True])
            self._accept(key + "-up", self._set_key, [key, False])
        self._accept("mouse3", self._set_looking, [True])
        self._accept("mouse3-up", self._set_looking, [False])
        self._accept("mouse1", self._select)
        self._accept("wheel_up", self._camera.add_wheel_step, [1])
        self._accept("wheel_down", self._camera.add_wheel_step, [-1])
        self._accept("escape", self._toggle_menu)
        self._accept("c", self._cycle_cutaway)
        self._accept("f", self._focus_selection)
        self._accept("r", self._reset_camera)
        self._accept("window-event", self._window_event)

    def _accept(self, event: str, callback: Callable[..., Any], extra_args: list[Any] | None = None) -> None:
        self._base.accept(event, callback, extra_args or [])
        self._events.append(event)

    def set_cutaway_mode(self, mode: Any) -> None:
        self._cutaway.set_mode(mode)

    def _set_key(self, key: str, pressed: bool) -> None:
        self._camera.set_key(key, pressed)

    def _set_looking(self, looking: bool) -> None:
        if not self.menu_open:
            self._camera.set_looking(looking)

    def _select(self) -> None:
        if not self.menu_open:
            self._picker.select_at_mouse()

    def _cycle_cutaway(self) -> None:
        if not self.menu_open:
            self._cutaway.cycle()

    def _focus_selection(self) -> None:
        if not self.menu_open and self._picker.selected is not None:
            target = self._picker.selected
            point = target.node.getPos(self._base.render) + target.focus_point
            self._camera.focus(tuple(point))

    def _reset_camera(self) -> None:
        if not self.menu_open:
            self._camera.reset()

    def _toggle_menu(self) -> None:
        self.menu_open = not self.menu_open
        self._camera.set_paused(self.menu_open)
        self._on_menu_change(self.menu_open)

    def _window_event(self, window: Any) -> None:
        if window is not None and window.getXSize() > 0 and window.getYSize() > 0:
            self._camera.on_window_resize()

    def close(self) -> None:
        self._camera.set_looking(False)
        for event in self._events:
            self._base.ignore(event)
        self._events.clear()
