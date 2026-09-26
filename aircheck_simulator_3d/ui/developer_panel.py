from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from aircheck_simulator_3d.app.config import DeveloperParameter, GraphicsConfig
from aircheck_simulator_3d.ui.theme import THEME


PARAMETER_LABELS = {
    "occupancy": "Людей в комнате",
    "outdoor_co2_ppm": "CO₂ снаружи, ppm",
    "outdoor_pm25_ug_m3": "PM2.5 снаружи",
    "outdoor_temperature_c": "Температура снаружи",
    "outdoor_humidity_percent": "Влажность снаружи",
    "indoor_pm25_generation_ug_min": "Источник PM2.5 в комнате",
    "wind_speed_m_s": "Скорость ветра, м/с",
    "infiltration_ach": "Инфильтрация, ACH",
    "filter_efficiency": "Эффективность фильтра",
    "intake_airflow_m3_h": "Приток, м³/ч",
    "exhaust_airflow_m3_h": "Вытяжка, м³/ч",
    "sensor_noise_percent": "Шум датчиков, %",
}


class DeveloperPanel:
    def __init__(
        self,
        base: Any,
        graphics: GraphicsConfig,
        font: Any,
        parameters: Mapping[str, DeveloperParameter],
        on_adjust: Callable[[str, int], None],
        on_speed_step: Callable[[int], None],
    ) -> None:
        from direct.gui.DirectGui import DirectButton, DirectFrame, DirectLabel
        from direct.gui import DirectGuiGlobals as DGG
        from panda3d.core import TextNode

        self._frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=THEME.panel,
            frameSize=(-1.00, 1.00, -0.75, 0.75),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        DirectLabel(
            parent=self._frame,
            text="ОТЛАДКА СИМУЛЯЦИИ  /  ограниченные настройки среды",
            text_fg=THEME.ink,
            text_scale=0.042,
            text_align=TextNode.ALeft,
            text_font=font,
            frameColor=(0, 0, 0, 0),
            pos=(-0.90, 0, 0.64),
            relief=DGG.FLAT,
        )
        self._values: dict[str, Any] = {}
        names = tuple(PARAMETER_LABELS)
        for index, name in enumerate(names):
            column = index // 6
            row = index % 6
            left = -0.87 if column == 0 else 0.08
            z = 0.48 - row * 0.16
            DirectLabel(
                parent=self._frame,
                text=PARAMETER_LABELS[name],
                text_fg=THEME.secondary,
                text_scale=0.030,
                text_align=TextNode.ALeft,
                text_font=font,
                frameColor=(0, 0, 0, 0),
                pos=(left, 0, z),
                relief=DGG.FLAT,
            )
            self._values[name] = DirectLabel(
                parent=self._frame,
                text="—",
                text_fg=THEME.accent,
                text_scale=0.031,
                text_align=TextNode.ACenter,
                text_font=font,
                frameColor=(0, 0, 0, 0),
                pos=(left + 0.43, 0, z),
                relief=DGG.FLAT,
            )
            for direction, x, sign in ((-1, left + 0.63, "−"), (1, left + 0.82, "+")):
                DirectButton(
                    parent=self._frame,
                    text=sign,
                    text_fg=THEME.ink,
                    text_scale=0.031,
                    text_font=font,
                    frameColor=(THEME.control, THEME.control_hover, THEME.control_pressed, THEME.control_disabled),
                    frameSize=(-0.075, 0.075, -0.045, 0.045),
                    command=on_adjust,
                    extraArgs=[name, direction],
                    pos=(x, 0, z),
                    relief=DGG.FLAT,
                )
        self._speed_value = DirectLabel(
            parent=self._frame,
            text="Скорость симуляции · 1×",
            text_fg=THEME.accent,
            text_scale=0.032,
            text_font=font,
            frameColor=(0, 0, 0, 0),
            pos=(0, 0, -0.61),
            relief=DGG.FLAT,
        )
        for direction, x, sign in ((-1, -0.27, "−"), (1, 0.27, "+")):
            DirectButton(
                parent=self._frame,
                text=sign,
                text_fg=THEME.ink,
                text_scale=0.031,
                text_font=font,
                frameColor=(THEME.control, THEME.control_hover, THEME.control_pressed, THEME.control_disabled),
                frameSize=(-0.12, 0.12, -0.05, 0.05),
                command=on_speed_step,
                extraArgs=[direction],
                pos=(x, 0, -0.61),
                relief=DGG.FLAT,
            )
        self._frame.hide()

    def update(self, values: Mapping[str, float], speed: float) -> None:
        for name, label in self._values.items():
            value = values.get(name, 0.0)
            digits = 0 if name in {"occupancy", "outdoor_co2_ppm"} else 1
            label["text"] = f"{value:.{digits}f}"
        self._speed_value["text"] = "Скорость симуляции · ПАУЗА" if speed == 0 else f"Скорость симуляции · {speed:g}×"

    def show(self) -> None:
        self._frame.show()

    def hide(self) -> None:
        self._frame.hide()

    def close(self) -> None:
        self._frame.destroy()
