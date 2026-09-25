from __future__ import annotations

from typing import Any

from aircheck_simulator_3d.app.config import GraphicsConfig
from aircheck_simulator_3d.scene.cutaway import CutawayMode
from aircheck_simulator_3d.scene.objects import SceneObject


class SceneOverlay:
    """Small scene-control and selection panels; not a simulation dashboard."""

    def __init__(self, base: Any, config: GraphicsConfig) -> None:
        from direct.gui.DirectGui import DirectFrame, DirectLabel
        from direct.gui import DirectGuiGlobals as DGG
        from direct.gui.OnscreenText import OnscreenText
        from panda3d.core import Filename, TextNode

        self._base = base
        self._aspect = base.getAspectRatio()
        self._font = base.loader.loadFont(str(Filename.fromOsSpecific(config.ui_font_path)))
        if self._font is None:
            raise RuntimeError(f"could not load UI font: {config.ui_font_path}")
        self._left_frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=(0.025, 0.07, 0.1, 0.88),
            frameSize=(-0.43, 0.43, -0.73, 0.04),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._left_title = DirectLabel(
            parent=self._left_frame,
            text="AIRCHECK  /  3D STAND",
            text_fg=(*config.text_rgb, 1),
            text_scale=0.043,
            text_align=TextNode.ALeft,
            text_font=self._font,
            frameColor=(0, 0, 0, 0),
            pos=(-0.37, 0, -0.07),
            relief=DGG.FLAT,
        )
        self._controls = DirectLabel(
            parent=self._left_frame,
            text="W A S D   move\nQ / E      vertical\nShift       fast move\nRMB         look\nWheel       dolly\nLMB         select\nF           focus\nR           reset camera\nC           cutaway wall\nEsc         menu / release",
            text_fg=(0.71, 0.83, 0.86, 1),
            text_scale=0.035,
            text_align=TextNode.ALeft,
            text_font=self._font,
            frameColor=(0, 0, 0, 0),
            pos=(-0.37, 0, -0.17),
            relief=DGG.FLAT,
        )
        self._wall_label = DirectLabel(
            parent=self._left_frame,
            text="WALL  /  TRANSPARENT",
            text_fg=(0.43, 0.9, 0.82, 1),
            text_scale=0.035,
            text_align=TextNode.ALeft,
            text_font=self._font,
            frameColor=(0, 0, 0, 0),
            pos=(-0.37, 0, -0.67),
            relief=DGG.FLAT,
        )
        self._right_frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=(0.025, 0.07, 0.1, 0.88),
            frameSize=(-0.43, 0.43, -0.58, 0.04),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._selection_title = DirectLabel(
            parent=self._right_frame,
            text="SCENE OBJECT",
            text_fg=(0.43, 0.9, 0.82, 1),
            text_scale=0.034,
            text_align=TextNode.ALeft,
            text_font=self._font,
            frameColor=(0, 0, 0, 0),
            pos=(-0.37, 0, -0.08),
            relief=DGG.FLAT,
        )
        self._selection_detail = DirectLabel(
            parent=self._right_frame,
            text="Наведите или выберите объект ЛКМ",
            text_fg=(*config.text_rgb, 1),
            text_scale=0.037,
            text_align=TextNode.ALeft,
            text_font=self._font,
            text_wordwrap=25,
            frameColor=(0, 0, 0, 0),
            pos=(-0.37, 0, -0.18),
            relief=DGG.FLAT,
        )
        self._status = OnscreenText(
            parent=base.aspect2d,
            text="",
            pos=(0, -0.94),
            align=TextNode.ACenter,
            fg=(0.72, 0.84, 0.87, 0.92),
            shadow=(0.01, 0.025, 0.04, 0.8),
            scale=0.031,
            font=self._font,
        )
        self._cursor = OnscreenText(
            parent=base.aspect2d,
            text="·",
            pos=(0, 0),
            align=TextNode.ACenter,
            fg=(0.72, 0.84, 0.87, 0.75),
            scale=0.055,
            mayChange=True,
            font=self._font,
        )
        self._help_frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=(0.025, 0.07, 0.1, 0.96),
            frameSize=(-0.72, 0.72, -0.49, 0.49),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._help_text = DirectLabel(
            parent=self._help_frame,
            text=(
                "УПРАВЛЕНИЕ СЦЕНОЙ\n\n"
                "W A S D   — свободное перемещение\n"
                "Q / E      — вниз / вверх\n"
                "Shift       — ускорение\n"
                "Зажмите ПКМ и двигайте мышь — обзор\n"
                "Колесо      — плавный наезд / отъезд\n"
                "ЛКМ         — выбрать объект\n"
                "F           — фокус на выборе\n"
                "R           — исходное положение камеры\n"
                "C           — переключить режим передней стены\n\n"
                "Esc — закрыть подсказку и продолжить"
            ),
            text_fg=(*config.text_rgb, 1),
            text_scale=0.042,
            text_align=TextNode.ALeft,
            text_font=self._font,
            text_wordwrap=44,
            frameColor=(0, 0, 0, 0),
            pos=(-0.62, 0, 0.37),
            relief=DGG.FLAT,
        )
        self._help_frame.hide()
        self._layout(self._aspect)

    def update(
        self,
        cutaway_mode: CutawayMode,
        hovered: SceneObject | None,
        selected: SceneObject | None,
        mouse: tuple[float, float] | None,
    ) -> None:
        mode_labels = {
            CutawayMode.VISIBLE: "WALL  /  VISIBLE",
            CutawayMode.TRANSPARENT: "WALL  /  TRANSPARENT",
            CutawayMode.HIDDEN: "WALL  /  HIDDEN",
        }
        self._wall_label["text"] = mode_labels[cutaway_mode]
        if selected is None:
            self._selection_title["text"] = "SCENE OBJECT"
            self._selection_detail["text"] = "Наведите или выберите объект ЛКМ"
            self._status.setText(f"Наведение: {hovered.title}" if hovered else "C — режим стены  •  F — фокус  •  R — исходная камера")
        else:
            self._selection_title["text"] = selected.title.upper()
            self._selection_detail["text"] = selected.description
            self._status.setText(f"Выбран объект: {selected.title}   •   F — фокус")
        if mouse is not None:
            self._cursor.show()
            self._cursor.setPos(mouse[0], mouse[1])
        else:
            self._cursor.hide()
        self._cursor["fg"] = (0.32, 1.0, 0.76, 0.95) if hovered else (0.72, 0.84, 0.87, 0.72)
        if hovered is None:
            self._cursor.setText("·")
        else:
            self._cursor.setText("+")

    def set_menu_open(self, open_: bool) -> None:
        if open_:
            self._help_frame.show()
        else:
            self._help_frame.hide()

    def on_resize(self, aspect: float) -> None:
        self._aspect = aspect
        self._layout(aspect)

    def _layout(self, aspect: float) -> None:
        side_offset = max(aspect - 0.45, 0.48)
        self._left_frame.setPos(-side_offset, 0, 0.93)
        self._right_frame.setPos(side_offset, 0, 0.93)

    def close(self) -> None:
        for element in (
            self._left_frame, self._right_frame, self._status, self._cursor, self._help_frame,
        ):
            element.destroy()
