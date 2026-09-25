from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from aircheck_simulator_3d.app.config import DeveloperParameter, GraphicsConfig


PARAMETER_LABELS = {
    "occupancy": "Occupants",
    "outdoor_co2_ppm": "Outdoor CO2 ppm",
    "outdoor_pm25_ug_m3": "Outdoor PM2.5",
    "outdoor_temperature_c": "Outdoor temp °C",
    "outdoor_humidity_percent": "Outdoor RH %",
    "indoor_pm25_generation_ug_min": "Indoor PM source",
    "wind_speed_m_s": "Wind m/s",
    "infiltration_ach": "Infiltration ACH",
    "filter_efficiency": "Filter efficiency",
    "intake_airflow_m3_h": "Intake m³/h",
    "exhaust_airflow_m3_h": "Exhaust m³/h",
    "sensor_noise_percent": "Sensor noise %",
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
            frameColor=(0.018, 0.052, 0.078, 0.98),
            frameSize=(-1.00, 1.00, -0.75, 0.75),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        DirectLabel(
            parent=self._frame,
            text="DEVELOPER PANEL  /  bounded live controls",
            text_fg=(*graphics.text_rgb, 1),
            text_scale=0.038,
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
                text_fg=(0.68, 0.82, 0.86, 1),
                text_scale=0.024,
                text_align=TextNode.ALeft,
                text_font=font,
                frameColor=(0, 0, 0, 0),
                pos=(left, 0, z),
                relief=DGG.FLAT,
            )
            self._values[name] = DirectLabel(
                parent=self._frame,
                text="—",
                text_fg=(0.44, 0.93, 0.79, 1),
                text_scale=0.024,
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
                    text_fg=(*graphics.text_rgb, 1),
                    text_scale=0.025,
                    text_font=font,
                    frameColor=(0.055, 0.18, 0.22, 0.96),
                    frameSize=(-0.075, 0.075, -0.045, 0.045),
                    command=on_adjust,
                    extraArgs=[name, direction],
                    pos=(x, 0, z),
                    relief=DGG.RAISED,
                )
        self._speed_value = DirectLabel(
            parent=self._frame,
            text="Simulation speed · 1×",
            text_fg=(0.44, 0.93, 0.79, 1),
            text_scale=0.027,
            text_font=font,
            frameColor=(0, 0, 0, 0),
            pos=(0, 0, -0.61),
            relief=DGG.FLAT,
        )
        for direction, x, sign in ((-1, -0.27, "−"), (1, 0.27, "+")):
            DirectButton(
                parent=self._frame,
                text=sign,
                text_fg=(*graphics.text_rgb, 1),
                text_scale=0.025,
                text_font=font,
                frameColor=(0.055, 0.18, 0.22, 0.96),
                frameSize=(-0.12, 0.12, -0.05, 0.05),
                command=on_speed_step,
                extraArgs=[direction],
                pos=(x, 0, -0.61),
                relief=DGG.RAISED,
            )
        self._frame.hide()

    def update(self, values: Mapping[str, float], speed: float) -> None:
        for name, label in self._values.items():
            value = values.get(name, 0.0)
            digits = 0 if name in {"occupancy", "outdoor_co2_ppm"} else 1
            label["text"] = f"{value:.{digits}f}"
        self._speed_value["text"] = "Simulation speed · PAUSED" if speed == 0 else f"Simulation speed · {speed:g}×"

    def show(self) -> None:
        self._frame.show()

    def hide(self) -> None:
        self._frame.hide()

    def close(self) -> None:
        self._frame.destroy()
