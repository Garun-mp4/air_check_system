from __future__ import annotations

from enum import Enum
from typing import Any

from aircheck_simulator_3d.scene.objects import PICKING_MASK_BIT, SceneObject


class CutawayMode(str, Enum):
    VISIBLE = "Visible"
    TRANSPARENT = "Transparent"
    HIDDEN = "Hidden"


class CutawayController:
    def __init__(self, wall: SceneObject, transparent_alpha: float = 0.24) -> None:
        if not 0 < transparent_alpha < 1:
            raise ValueError("transparent_alpha must be between zero and one")
        self._wall = wall
        self._alpha = transparent_alpha
        self._mode = CutawayMode.TRANSPARENT
        self.set_mode(self._mode)

    @property
    def mode(self) -> CutawayMode:
        return self._mode

    def cycle(self) -> CutawayMode:
        modes = tuple(CutawayMode)
        return self.set_mode(modes[(modes.index(self._mode) + 1) % len(modes)])

    def set_mode(self, mode: CutawayMode) -> CutawayMode:
        from panda3d.core import BitMask32, TransparencyAttrib

        if not isinstance(mode, CutawayMode):
            raise ValueError(f"unsupported cutaway mode: {mode!r}")
        self._mode = mode
        if mode is CutawayMode.HIDDEN:
            self._wall.node.hide()
            self._wall.collider.node().setIntoCollideMask(BitMask32.allOff())
        else:
            self._wall.node.show()
            if mode is CutawayMode.TRANSPARENT:
                self._wall.visual.setTransparency(TransparencyAttrib.MAlpha)
                self._wall.visual.setColorScale(1, 1, 1, self._alpha)
                self._wall.visual.setDepthWrite(False)
                self._wall.collider.node().setIntoCollideMask(BitMask32.allOff())
            else:
                self._wall.visual.clearTransparency()
                self._wall.visual.clearColorScale()
                self._wall.visual.clearDepthWrite()
                self._wall.collider.node().setIntoCollideMask(BitMask32.bit(PICKING_MASK_BIT))
        return mode
