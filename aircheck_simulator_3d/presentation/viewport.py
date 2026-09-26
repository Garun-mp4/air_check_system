from __future__ import annotations

import logging
from typing import Any

from aircheck_simulator_3d.app.config import (
    CameraConfig,
    DemoConfig,
    DeviceConfig,
    GraphicsConfig,
    PhysicsConfig,
    SceneConfig,
)
from aircheck_simulator_3d.devices.presentation_state import DevicePresentationState
from aircheck_simulator_3d.networking.contracts import BackendForecast
from aircheck_simulator_3d.presentation.camera_controller import CameraController
from aircheck_simulator_3d.presentation.airflow_visualization import AirflowVisualization
from aircheck_simulator_3d.presentation.device_bindings import DeviceVisualBindings
from aircheck_simulator_3d.presentation.input_controller import InputController
from aircheck_simulator_3d.presentation.visualization_mode import VisualizationMode
from aircheck_simulator_3d.scene.cutaway import CutawayController
from aircheck_simulator_3d.scene.picking import ScenePicker
from aircheck_simulator_3d.scene.scene_builder import StandScene
from aircheck_simulator_3d.ui.scene_overlay import SceneOverlay


LOGGER = logging.getLogger("aircheck.application.presentation.viewport")


class SimulatorViewport:
    """Composition boundary for scene, view controls, object picking and concise UI."""

    _UI_UPDATE_INTERVAL_SECONDS = 0.1

    def __init__(
        self,
        base: Any,
        graphics: GraphicsConfig,
        scene_config: SceneConfig,
        camera_config: CameraConfig,
        initial_device_state: DevicePresentationState,
        initial_simulation_speed: float,
        device_config: DeviceConfig,
        physics_config: PhysicsConfig,
        demo_config: DemoConfig,
        dashboard_url: str = "",
    ) -> None:
        self._base = base
        from panda3d.core import ClockObject

        self._clock = ClockObject.getGlobalClock()
        self._scene = StandScene(base, scene_config)
        self._device_bindings = DeviceVisualBindings(self._scene.device_scene)
        self._airflow_visualization = AirflowVisualization(
            self._scene.root,
            scene_config,
            device_config,
            physics_config,
            graphics.airflow_particles_per_track,
        )
        self.apply_device_state(initial_device_state, 0.0)
        self._overlay = SceneOverlay(
            base,
            graphics,
            dashboard_url,
            scenarios=demo_config.scenarios,
            developer_parameters=demo_config.developer_parameters,
        )
        self._overlay.set_simulation_speed(initial_simulation_speed)
        self._cutaway = CutawayController(self._scene.cutaway_wall)
        self._picker = ScenePicker(base, self._scene.objects)
        self._camera = CameraController(base, camera_config)
        self._input = InputController(
            base,
            self._camera,
            self._picker,
            self._cutaway,
            self._overlay.set_menu_open,
            lambda: self._overlay.modal_open,
            self._overlay.pointer_over_ui,
        )
        self._previous_aspect = base.getAspectRatio()
        apply_window_aspect(self._previous_aspect, base.camLens, self._overlay.on_resize)
        self._elapsed = 0.0
        self._frame_count = 0
        self._fps_window_seconds = 0.0
        self._fps_window_frames = 0
        self._minimum_window_fps = float("inf")
        self._live_state: Any | None = None
        self._live_pending_commands = 0
        self._last_telemetry_at: str | None = None
        self._developer_values: dict[str, float] = {}
        self._scenario_name = "Normal Room"
        self._demo_status: Any | None = None
        self._ui_update_elapsed = self._UI_UPDATE_INTERVAL_SECONDS
        self.set_visualization_mode(VisualizationMode.NORMAL)
        self._closed = False
        self._task = base.taskMgr.add(self._update, "aircheck-viewport-update", sort=20)
        LOGGER.info("Built 3D stand with %d interactive scene targets", len(self._scene.objects))

    def apply_device_state(self, state: DevicePresentationState, delta_seconds: float) -> None:
        self._device_bindings.apply(state, delta_seconds)

    def set_simulation_speed(self, speed: float) -> None:
        self._overlay.set_simulation_speed(speed)

    def set_backend_status(
        self,
        online: bool,
        forecast: BackendForecast | None,
        message: str | None = None,
    ) -> None:
        self._overlay.set_backend_status(online, forecast, message)

    def set_action_handlers(self, **handlers: Any) -> None:
        self._overlay.set_action_handlers(**handlers)

    @property
    def input_blocked(self) -> bool:
        return self._input.interaction_blocked

    def set_scenario_name(self, name: str) -> None:
        self._scenario_name = name
        self._overlay.set_scenario_name(name)

    def set_last_telemetry(self, accepted_at: str) -> None:
        self._last_telemetry_at = accepted_at
        self._overlay.set_last_telemetry(accepted_at)

    def set_visualization_mode(self, mode: VisualizationMode) -> None:
        self._overlay.set_visualization_mode(mode, notify=False)
        self._airflow_visualization.set_visible(mode in {VisualizationMode.AIRFLOW, VisualizationMode.TECHNICAL})
        wiring = self._scene.device_scene.wiring
        if wiring is not None:
            wiring.show() if mode in {VisualizationMode.WIRING, VisualizationMode.TECHNICAL} else wiring.hide()
        for sensor_id in self._SENSOR_OBJECT_IDS:
            sensor = self._scene.objects.get(sensor_id)
            if sensor is not None:
                sensor.set_mode_highlight(mode in {VisualizationMode.SENSORS, VisualizationMode.TECHNICAL})

    _SENSOR_OBJECT_IDS = (
        "sensor.scd41.indoor", "sensor.sps30.indoor", "sensor.sht45.outdoor", "sensor.sps30.outdoor"
    )

    def update_application_state(
        self,
        state: Any,
        *,
        pending_commands: int,
        last_telemetry_at: str | None,
        developer_values: dict[str, float],
        demo_status: Any,
    ) -> None:
        self._live_state = state
        self._live_pending_commands = pending_commands
        self._last_telemetry_at = last_telemetry_at
        self._developer_values = developer_values
        self._demo_status = demo_status

    def _update(self, task: Any) -> Any:
        dt = min(max(float(self._clock.getDt()), 0.0), 0.1)
        self._camera.set_paused(self._input.interaction_blocked)
        self._camera.update(dt)
        if self._live_state is not None:
            self._airflow_visualization.apply(self._live_state.airflow, dt)
        pointer_over_ui = self._overlay.pointer_over_ui()
        hovered = self._picker.update(
            enabled=not self._input.interaction_blocked and not pointer_over_ui
        )
        watcher = self._base.mouseWatcherNode
        mouse = None
        if watcher.hasMouse() and not self._camera.looking:
            point = watcher.getMouse()
            mouse = (point.getX(), point.getY())
        self._ui_update_elapsed += dt
        if self._live_state is not None and self._ui_update_elapsed >= self._UI_UPDATE_INTERVAL_SECONDS:
            self._ui_update_elapsed %= self._UI_UPDATE_INTERVAL_SECONDS
            self._overlay.update(
                self._cutaway.mode,
                hovered,
                self._picker.selected,
                mouse,
                self._live_state,
                pending_commands=self._live_pending_commands,
                last_telemetry_at=self._last_telemetry_at,
                developer_values=self._developer_values,
                demo_status=self._demo_status,
            )

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
        self._airflow_visualization.close()
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
