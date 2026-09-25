from __future__ import annotations

import logging
from typing import Any

from aircheck_simulator_3d.app.config import CameraConfig, GraphicsConfig, SceneConfig
from aircheck_simulator_3d.presentation.camera_controller import CameraController
from aircheck_simulator_3d.presentation.input_controller import InputController
from aircheck_simulator_3d.scene.cutaway import CutawayController
from aircheck_simulator_3d.scene.picking import ScenePicker
from aircheck_simulator_3d.scene.scene_builder import StandScene
from aircheck_simulator_3d.ui.scene_overlay import SceneOverlay


LOGGER = logging.getLogger("aircheck.application.presentation.viewport")


class SimulatorViewport:
    """Composition boundary for scene, view controls, object picking and concise UI."""

    def __init__(
        self,
        base: Any,
        graphics: GraphicsConfig,
        scene_config: SceneConfig,
        camera_config: CameraConfig,
    ) -> None:
        self._base = base
        from panda3d.core import ClockObject

        self._clock = ClockObject.getGlobalClock()
        self._scene = StandScene(base, scene_config)
        self._overlay = SceneOverlay(base, graphics)
        self._cutaway = CutawayController(self._scene.cutaway_wall)
        self._picker = ScenePicker(base, self._scene.objects)
        self._camera = CameraController(base, camera_config)
        self._input = InputController(
            base,
            self._camera,
            self._picker,
            self._cutaway,
            self._overlay.set_menu_open,
        )
        self._previous_aspect = base.getAspectRatio()
        apply_window_aspect(self._previous_aspect, base.camLens, self._overlay.on_resize)
        self._elapsed = 0.0
        self._frame_count = 0
        self._fps_window_seconds = 0.0
        self._fps_window_frames = 0
        self._minimum_window_fps = float("inf")
        self._closed = False
        self._task = base.taskMgr.add(self._update, "aircheck-viewport-update", sort=20)
        LOGGER.info("Built 3D stand with %d interactive scene targets", len(self._scene.objects))

    def _update(self, task: Any) -> Any:
        dt = min(max(float(self._clock.getDt()), 0.0), 0.1)
        self._camera.update(dt)
        hovered = self._picker.update(enabled=not self._input.menu_open)
        watcher = self._base.mouseWatcherNode
        mouse = None
        if watcher.hasMouse() and not self._camera.looking:
            point = watcher.getMouse()
            mouse = (point.getX(), point.getY())
        self._overlay.update(self._cutaway.mode, hovered, self._picker.selected, mouse)

        width = self._base.win.getXSize()
        height = self._base.win.getYSize()
        aspect = window_aspect_ratio(width, height)
        if aspect > 0 and abs(aspect - self._previous_aspect) > 0.005:
            self._previous_aspect = aspect
            apply_window_aspect(aspect, self._base.camLens, self._overlay.on_resize)
        self._record_frame(dt)
        return task.cont

    def _record_frame(self, dt: float) -> None:
        if dt <= 0 or dt > 0.1:
            return
        self._elapsed += dt
        self._frame_count += 1
        if self._elapsed > 1.0:
            self._fps_window_seconds += dt
            self._fps_window_frames += 1
            if self._fps_window_seconds >= 1.0:
                self._minimum_window_fps = min(
                    self._minimum_window_fps,
                    self._fps_window_frames / self._fps_window_seconds,
                )
                self._fps_window_seconds = 0.0
                self._fps_window_frames = 0

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._base.taskMgr.remove(self._task)
        self._input.close()
        self._picker.close()
        self._camera.close()
        self._overlay.close()
        self._scene.close()
        if self._elapsed > 1.0:
            average_fps = self._frame_count / self._elapsed
            minimum_fps = self._minimum_window_fps if self._minimum_window_fps != float("inf") else average_fps
            LOGGER.info(
                "Viewport performance: %.1f average FPS, %.1f minimum rolling FPS over %.1f seconds",
                average_fps,
                minimum_fps,
                self._elapsed,
            )


def window_aspect_ratio(width: int, height: int) -> float:
    if width <= 0 or height <= 0:
        return 0.0
    return width / height


def apply_window_aspect(aspect: float, lens: Any, on_resize: Any) -> None:
    if aspect <= 0:
        return
    lens.setAspectRatio(aspect)
    on_resize(aspect)
