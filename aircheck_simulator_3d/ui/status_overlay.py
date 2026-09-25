from __future__ import annotations

from aircheck_simulator_3d.app.config import GraphicsConfig


class StatusOverlay:
    def __init__(self, parent: object, config: GraphicsConfig) -> None:
        from panda3d.core import TextNode

        text_node = TextNode("aircheck-startup-status")
        text_node.setText("AirCheck 3D Simulator\nDigital twin foundation is running")
        text_node.setAlign(TextNode.ACenter)
        text_node.setTextColor(*config.text_rgb, 1)
        self._node = parent.attachNewNode(text_node)
        self._node.setScale(config.text_scale)
        self._node.setPos(0, 0, 0)

    def close(self) -> None:
        self._node.removeNode()
