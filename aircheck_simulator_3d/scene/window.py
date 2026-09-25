from __future__ import annotations

from aircheck_simulator_3d.app.config import GraphicsConfig
from aircheck_simulator_3d.ui.status_overlay import StatusOverlay


class PandaWindow:
    """Minimal Panda3D host; scene geometry and camera controls are deferred."""

    def __init__(self, config: GraphicsConfig) -> None:
        try:
            from panda3d.core import WindowProperties, loadPrcFileData
            from direct.showbase.ShowBase import ShowBase
        except ImportError as exc:
            raise RuntimeError(
                "Panda3D is not installed. Install aircheck_simulator_3d/requirements.txt first."
            ) from exc

        loadPrcFileData("", f"window-title {config.window_title}")
        loadPrcFileData("", f"win-size {config.width} {config.height}")
        loadPrcFileData("", f"fullscreen {'true' if config.fullscreen else 'false'}")
        loadPrcFileData("", "audio-library-name null")
        self._base = ShowBase(windowType="onscreen")
        if self._base.win is None:
            self._base.destroy()
            raise RuntimeError("Panda3D could not create an onscreen window")
        window_properties = WindowProperties()
        window_properties.setTitle(config.window_title)
        self._base.win.requestProperties(window_properties)
        self._base.setBackgroundColor(*config.background_rgb, 1)
        self._overlay = StatusOverlay(self._base.aspect2d, config)
        self._closed = False

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
        self._overlay.close()
        self._base.destroy()
