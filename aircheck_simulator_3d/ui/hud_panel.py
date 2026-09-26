from __future__ import annotations

from typing import Any

from aircheck_simulator_3d.app.config import GraphicsConfig
from aircheck_simulator_3d.networking.contracts import BackendForecast
from aircheck_simulator_3d.simulation.state import SimulationState
from aircheck_simulator_3d.ui.presentation_data import hud_data
from aircheck_simulator_3d.ui.theme import THEME


class HudPanel:
    """Compact room readout with CO₂ as the primary live value."""

    def __init__(self, base: Any, graphics: GraphicsConfig, font: Any) -> None:
        from direct.gui.DirectGui import DirectFrame, DirectLabel
        from direct.gui import DirectGuiGlobals as DGG
        self._base = base
        self._frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=THEME.panel,
            frameSize=(-0.56, 0.56, -0.67, 0.08),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._accent = DirectFrame(
            parent=self._frame,
            frameColor=THEME.accent,
            frameSize=(-0.56, 0.56, -0.008, 0.008),
            pos=(0, 0, 0.065),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._title = self._label(DirectLabel, font, -0.47, 0.025, 0.032, THEME.secondary)
        self._co2_caption = self._label(DirectLabel, font, -0.47, -0.095, 0.030, THEME.muted)
        self._co2_value = self._label(DirectLabel, font, -0.47, -0.205, 0.058, THEME.ink)
        self._indoor_metrics = self._label(DirectLabel, font, 0.02, -0.135, 0.030, THEME.ink)
        self._outdoor = self._label(DirectLabel, font, -0.47, -0.315, 0.030, THEME.secondary)
        self._devices = self._label(DirectLabel, font, -0.47, -0.405, 0.030, THEME.secondary)
        self._forecast = self._label(DirectLabel, font, -0.47, -0.525, 0.027, THEME.secondary)
        self._demo = self._label(DirectLabel, font, -0.47, -0.615, 0.029, THEME.muted)
        self._aspect = base.getAspectRatio()
        self.on_resize(self._aspect)

    def _label(
        self,
        label_type: Any,
        font: Any,
        x: float,
        z: float,
        scale: float,
        color: tuple[float, float, float, float],
    ) -> Any:
        from direct.gui import DirectGuiGlobals as DGG
        from panda3d.core import TextNode

        return label_type(
            parent=self._frame,
            text="",
            text_fg=color,
            text_scale=scale,
            text_align=TextNode.ALeft,
            text_font=font,
            text_wordwrap=34,
            frameColor=(0, 0, 0, 0),
            pos=(x, 0, z),
            relief=DGG.FLAT,
        )

    def update(
        self,
        state: SimulationState,
        forecast: BackendForecast | None,
        backend_online: bool,
        scenario_name: str,
        demo_phase: str,
    ) -> None:
        data = hud_data(state, forecast, backend_online, scenario_name, demo_phase)
        self._title["text"] = f"ВОЗДУХ  /  {data['scenario'].upper()}"
        self._co2_caption["text"] = "CO₂ В ПОМЕЩЕНИИ"
        self._co2_value["text"] = data["co2"]
        self._indoor_metrics["text"] = (
            f"PM2.5  {data['pm25']}\n"
            f"ТЕМПЕРАТУРА  {data['temperature']}\n"
            f"ВЛАЖНОСТЬ  {data['humidity']}"
        )
        self._outdoor["text"] = (
            f"УЛИЦА  ·  PM2.5 {data['outdoor_pm25']}\n"
            f"{data['outdoor_temperature']}  ·  ВЛАЖНОСТЬ {data['outdoor_humidity']}"
        )
        self._devices["text"] = (
            f"ОКНО {data['window']}\n"
            f"ПРИТОК {data['intake']}\n"
            f"ВЫТЯЖКА {data['exhaust']}"
        )
        self._forecast["text"] = (
            f"ПРОГНОЗ CO₂ +15 МИН  {data['forecast']}\n"
            f"СВЯЗЬ {data['backend']}  ·  СИМУЛЯЦИЯ {data['speed']}"
        )
        self._forecast["text_fg"] = THEME.good if backend_online else THEME.warning
        self._demo["text"] = f"АВТОДЕМО  ·  {data['demo']}"

    def on_resize(self, aspect: float) -> None:
        self._aspect = aspect
        self._frame.setPos(-aspect + 0.70, 0, 0.71)

    def close(self) -> None:
        self._frame.destroy()
