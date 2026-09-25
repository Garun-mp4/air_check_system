from __future__ import annotations

from typing import Any

from aircheck_simulator_3d.app.config import GraphicsConfig
from aircheck_simulator_3d.networking.contracts import BackendForecast
from aircheck_simulator_3d.simulation.state import SimulationState
from aircheck_simulator_3d.ui.presentation_data import format_hud


class HudPanel:
    def __init__(self, base: Any, graphics: GraphicsConfig, font: Any) -> None:
        from direct.gui.DirectGui import DirectFrame, DirectLabel
        from direct.gui import DirectGuiGlobals as DGG
        from panda3d.core import TextNode

        self._base = base
        self._frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=(0.025, 0.07, 0.1, 0.86),
            frameSize=(-0.37, 0.37, -0.62, 0.0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._label = DirectLabel(
            parent=self._frame,
            text="",
            text_fg=(*graphics.text_rgb, 1),
            text_scale=0.027,
            text_align=TextNode.ALeft,
            text_font=font,
            text_wordwrap=23,
            frameColor=(0, 0, 0, 0),
            pos=(-0.24, 0, -0.055),
            relief=DGG.FLAT,
        )
        self._aspect = base.getAspectRatio()

    def update(
        self,
        state: SimulationState,
        forecast: BackendForecast | None,
        backend_online: bool,
        scenario_name: str,
        demo_phase: str,
    ) -> None:
        self._label["text"] = format_hud(state, forecast, backend_online, scenario_name, demo_phase)

    def on_resize(self, aspect: float) -> None:
        self._aspect = aspect
        self._frame.setPos(-aspect + 0.95, 0, 0.76)

    def close(self) -> None:
        self._frame.destroy()
