from __future__ import annotations

import logging
from typing import Any

from aircheck_simulator_3d.app.config import GraphicsConfig


LOGGER = logging.getLogger("aircheck.application.scene.lighting")


class SceneLighting:
    def __init__(self, base: Any, config: GraphicsConfig) -> None:
        from panda3d.core import AmbientLight, DirectionalLight, LColor

        self._base = base
        ambient = AmbientLight("aircheck-ambient")
        ambient.setColor(LColor(*config.ambient_rgb, 1))
        self._ambient_path = base.render.attachNewNode(ambient)
        base.render.setLight(self._ambient_path)

        sun = DirectionalLight("aircheck-key-light")
        sun.setColor(LColor(*config.sun_rgb, 1))
        if config.shadows_enabled:
            sun.setShadowCaster(True, config.shadow_map_size, config.shadow_map_size)
            sun.getLens().setFilmSize(20, 20)
            sun.getLens().setNearFar(1, 45)
        self._sun_path = base.render.attachNewNode(sun)
        self._sun_path.setPos(8, -9, 14)
        self._sun_path.setHpr(-32, -52, 0)
        base.render.setLight(self._sun_path)

        if config.shadows_enabled:
            # Panda's generated lighting shader is required for its built-in shadow maps.
            try:
                base.render.setShaderAuto()
                LOGGER.info("Directional shadow mapping enabled at %s px", config.shadow_map_size)
            except Exception:
                sun.setShadowCaster(False)
                LOGGER.exception("Shadow shader setup failed; continuing with ambient and directional lighting")
        else:
            LOGGER.info("Shadow mapping disabled by graphics.toml")

    def close(self) -> None:
        self._base.render.clearLight(self._ambient_path)
        self._base.render.clearLight(self._sun_path)
        self._ambient_path.removeNode()
        self._sun_path.removeNode()
        self._base.render.clearShader()
