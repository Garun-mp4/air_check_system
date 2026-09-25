from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from aircheck_simulator_3d.app.config import GraphicsConfig, ScenarioPreset


class ScenarioPanel:
    def __init__(
        self,
        base: Any,
        graphics: GraphicsConfig,
        font: Any,
        scenarios: Sequence[ScenarioPreset],
        on_select: Callable[[str], None],
    ) -> None:
        from direct.gui.DirectGui import DirectButton, DirectFrame, DirectLabel
        from direct.gui import DirectGuiGlobals as DGG
        from panda3d.core import TextNode

        self._frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=(0.018, 0.052, 0.078, 0.98),
            frameSize=(-0.88, 0.88, -0.68, 0.68),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        DirectLabel(
            parent=self._frame,
            text="DEMO SCENARIOS  /  выберите исходные условия",
            text_fg=(*graphics.text_rgb, 1),
            text_scale=0.038,
            text_align=TextNode.ALeft,
            text_font=font,
            frameColor=(0, 0, 0, 0),
            pos=(-0.78, 0, 0.55),
            relief=DGG.FLAT,
        )
        self._buttons = []
        for index, scenario in enumerate(scenarios):
            column = index % 3
            row = index // 3
            x = -0.57 + column * 0.57
            z = 0.31 - row * 0.23
            self._buttons.append(
                DirectButton(
                    parent=self._frame,
                    text=scenario.title,
                    text_fg=(*graphics.text_rgb, 1),
                    text_scale=0.025,
                    text_font=font,
                    frameColor=(0.055, 0.18, 0.22, 0.96),
                    frameSize=(-0.25, 0.25, -0.055, 0.055),
                    command=on_select,
                    extraArgs=[scenario.scenario_id],
                    pos=(x, 0, z),
                    relief=DGG.RAISED,
                )
            )
        self._frame.hide()

    def show(self) -> None:
        self._frame.show()

    def hide(self) -> None:
        self._frame.hide()

    def close(self) -> None:
        self._frame.destroy()
