from __future__ import annotations

from typing import Any

from aircheck_simulator_3d.app.config import GraphicsConfig
from aircheck_simulator_3d.networking.contracts import BackendForecast
from aircheck_simulator_3d.scene.objects import SceneObject
from aircheck_simulator_3d.simulation.state import SimulationState
from aircheck_simulator_3d.ui.presentation_data import device_details
from aircheck_simulator_3d.ui.theme import THEME


class DevicePanel:
    def __init__(self, base: Any, graphics: GraphicsConfig, font: Any) -> None:
        from direct.gui.DirectGui import DirectFrame, DirectLabel
        from direct.gui import DirectGuiGlobals as DGG
        from panda3d.core import TextNode

        self._base = base
        self._frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=THEME.panel,
            frameSize=(-0.48, 0.48, -0.48, 0.10),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._title = DirectLabel(
            parent=self._frame,
            text="УСТРОЙСТВО",
            text_fg=THEME.accent,
            text_scale=0.038,
            text_align=TextNode.ALeft,
            text_font=font,
            frameColor=(0, 0, 0, 0),
            pos=(-0.40, 0, 0.025),
            relief=DGG.FLAT,
        )
        self._detail = DirectLabel(
            parent=self._frame,
            text="Выберите узел на стенде",
            text_fg=THEME.ink,
            text_scale=0.031,
            text_align=TextNode.ALeft,
            text_font=font,
            text_wordwrap=28,
            frameColor=(0, 0, 0, 0),
            pos=(-0.40, 0, -0.075),
            relief=DGG.FLAT,
        )
        self._aspect = base.getAspectRatio()
        self._visible = True

    def update(
        self,
        selected: SceneObject | None,
        state: SimulationState,
        *,
        backend_online: bool,
        backend_message: str | None,
        last_telemetry_at: str | None,
        pending_commands: int,
    ) -> None:
        title, detail = device_details(
            selected,
            state,
            backend_online=backend_online,
            backend_message=backend_message,
            last_telemetry_at=last_telemetry_at,
            pending_commands=pending_commands,
        )
        self._title["text"] = title.upper()
        self._detail["text"] = detail

    def set_visible(self, visible: bool) -> None:
        self._visible = visible
        self._frame.show() if visible else self._frame.hide()

    @property
    def visible(self) -> bool:
        return self._visible

    def on_resize(self, aspect: float) -> None:
        self._aspect = aspect
        self._frame.setPos(aspect - 0.60, 0, 0.37)

    def close(self) -> None:
        self._frame.destroy()
