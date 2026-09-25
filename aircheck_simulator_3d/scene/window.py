from __future__ import annotations

import logging

from aircheck_simulator_3d.app.runtime import ApplicationRuntime
from aircheck_simulator_3d.app.config import CameraConfig, GraphicsConfig, SceneConfig
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.simulation.engine import SimulationEngine
from aircheck_simulator_3d.scene.lighting import SceneLighting
from aircheck_simulator_3d.presentation.viewport import SimulatorViewport


LOGGER = logging.getLogger("aircheck.application.scene.window")


class PandaWindow:
    """Panda3D window and graphics host. Scene composition lives in SimulatorViewport."""

    def __init__(
        self,
        config: GraphicsConfig,
        scene: SceneConfig,
        camera: CameraConfig,
        devices: DeviceLayer,
        simulation: SimulationEngine,
    ) -> None:
        try:
            from panda3d.core import AntialiasAttrib, WindowProperties, loadPrcFileData
            from direct.showbase.ShowBase import ShowBase
        except ImportError as exc:
            raise RuntimeError(
                "Panda3D is not installed. Install aircheck_simulator_3d/requirements.txt first."
            ) from exc

        loadPrcFileData("", f"window-title {config.window_title}")
        loadPrcFileData("", f"win-size {config.width} {config.height}")
        loadPrcFileData("", f"fullscreen {'true' if config.fullscreen else 'false'}")
        loadPrcFileData("", "audio-library-name null")
        loadPrcFileData("", f"framebuffer-multisample {'1' if config.multisample_enabled else '0'}")
        loadPrcFileData("", f"multisamples {config.multisamples}")
        self._base = ShowBase(windowType="onscreen")
        if self._base.win is None:
            self._base.destroy()
            raise RuntimeError("Panda3D could not create an onscreen window")
        window_properties = WindowProperties()
        window_properties.setTitle(config.window_title)
        self._base.win.requestProperties(window_properties)
        self._base.setBackgroundColor(*config.background_rgb, 1)
        self._closed = False
        self._lighting = None
        self._viewport = None
        self._runtime = None
        try:
            self._lighting = SceneLighting(self._base, config)
            self._viewport = SimulatorViewport(
                self._base,
                config,
                scene,
                camera,
                devices.presentation_state,
                simulation.state.simulation_speed,
            )
            self._runtime = ApplicationRuntime(self._base, devices, self._viewport, simulation)
            framebuffer_samples = self._base.win.getFbProperties().getMultisamples()
            if config.multisample_enabled and framebuffer_samples > 0:
                self._base.render.setAntialias(AntialiasAttrib.MMultisample)
                LOGGER.info("Multisampling active (%d samples)", framebuffer_samples)
            elif config.multisample_enabled:
                LOGGER.warning("Requested MSAA is unavailable; running without multisample antialiasing")
            LOGGER.info(
                "Panda3D window ready at %dx%d (%.2f aspect)",
                self._base.win.getXSize(), self._base.win.getYSize(), self._base.getAspectRatio(),
            )
        except Exception:
            if self._runtime is not None:
                self._runtime.close()
            if self._viewport is not None:
                self._viewport.close()
            if self._lighting is not None:
                self._lighting.close()
            self._base.destroy()
            raise

    def run(self, smoke_test_seconds: float | None = None) -> None:
        if smoke_test_seconds is not None:
            self._base.taskMgr.doMethodLater(
                smoke_test_seconds,
                self._stop_after_smoke_test,
                "aircheck-smoke-test-shutdown",
            )
        self._base.run()

    def _stop_after_smoke_test(self, task: object) -> object:
        self._base.userExit()
        return task.done

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._runtime is not None:
            self._runtime.close()
        if self._viewport is not None:
            self._viewport.close()
        if self._lighting is not None:
            self._lighting.close()
        self._base.destroy()
