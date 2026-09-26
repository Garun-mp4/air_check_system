from __future__ import annotations

from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig
from aircheck_simulator_3d.scene.device_models.device_scene import DeviceScene, build_device_scene
from aircheck_simulator_3d.scene.objects import SceneObject, make_box, register_pickable


class StandScene:
    """Builds the room and composes independently built physical device assemblies."""

    def __init__(self, base: Any, config: SceneConfig) -> None:
        from panda3d.core import PandaNode

        self._base = base
        self.config = config
        self.root = base.render.attachNewNode(PandaNode("aircheck-stand"))
        self.objects: dict[str, SceneObject] = {}
        self.cutaway_wall: SceneObject
        self.device_scene: DeviceScene
        self._build()

    def _build(self) -> None:
        width = self.config.room_width_m
        depth = self.config.room_depth_m
        height = self.config.room_height_m
        thickness = self.config.wall_thickness_m
        floor_top = 0.04
        back_y = depth / 2
        front_y = -depth / 2
        wall_z = floor_top + height / 2
        platform_width = width + self.config.platform_margin_m * 2
        platform_depth = depth + self.config.outdoor_depth_m + self.config.platform_margin_m * 2
        platform_center_y = self.config.outdoor_depth_m / 2
        platform = self._entity(
            "stand.platform",
            "Основание стенда",
            "Общее основание помещения и наружного участка стенда.",
            (0, platform_center_y, -0.22),
        )
        make_box(platform.visual, "plinth-edge", (0, 0, -0.01), (platform_width, platform_depth, 0.2), (0.14, 0.19, 0.23, 1), specular=(0.2, 0.25, 0.28), shininess=42)
        self._register_existing(platform, (platform_width / 2, platform_depth / 2, 0.11))

        floor = self._entity(
            "room.floor",
            "Пол помещения",
            "Внутренний пол контролируемой комнаты.",
            (0, 0, -0.05),
        )
        make_box(floor.visual, "room-floor-finish", (0, 0, 0), (width, depth, 0.18), (0.72, 0.76, 0.71, 1), specular=(0.16, 0.18, 0.16), shininess=18)
        self._register_existing(floor, (width / 2, depth / 2, 0.1))

        outdoor_depth = self.config.outdoor_depth_m
        if outdoor_depth > 0:
            garden = self._entity(
                "environment.outdoor",
                "Наружный участок",
                "Условная внешняя среда для размещения наружного узла и показа окна.",
                (0, back_y + outdoor_depth / 2, -0.095),
            )
            make_box(garden.visual, "outdoor-ground", (0, 0, 0), (width + self.config.platform_margin_m * 2, outdoor_depth, 0.035), (0.55, 0.70, 0.53, 1), specular=(0.08, 0.12, 0.1), shininess=8)
            self._register_existing(garden, ((width + self.config.platform_margin_m * 2) / 2, outdoor_depth / 2, 0.03))

        self._add_wall(
            "wall.left", "Левая стена", "Боковая стена комнаты.",
            (-width / 2 - thickness / 2, 0, wall_z), (thickness, depth, height),
        )
        self._add_wall(
            "wall.right", "Правая стена", "Боковая стена комнаты.",
            (width / 2 + thickness / 2, 0, wall_z), (thickness, depth, height),
        )
        self.cutaway_wall = self._add_wall(
            "wall.cutaway", "Передняя стена", "Стена с режимом обзора: видимая, прозрачная или скрытая.",
            (0, front_y - thickness / 2, wall_z), (width, thickness, height),
        )

        ceiling = self._entity(
            "room.ceiling", "Потолок", "Верхняя панель демонстрационной комнаты.",
            (0, 0, floor_top + height + thickness / 2),
        )
        ceiling_visual = make_box(ceiling.visual, "room-ceiling-panel", (0, 0, 0), (width + thickness * 2, depth + thickness * 2, thickness), (0.64, 0.69, 0.65, 1), specular=(0.14, 0.16, 0.14), shininess=18)
        self._register_existing(ceiling, ((width + thickness * 2) / 2, (depth + thickness * 2) / 2, thickness / 2), ceiling_visual)

        self.device_scene = build_device_scene(self.root, self.config)
        self.objects.update(self.device_scene.objects)

        self._add_world_edge("platform-front-edge", (0, front_y - self.config.platform_margin_m * 0.48, -0.105), (platform_width, 0.025, 0.035), (0.26, 0.61, 0.66, 1))

    def _entity(
        self,
        object_id: str,
        title: str,
        description: str,
        position: tuple[float, float, float],
    ) -> SceneObject:
        from panda3d.core import PandaNode

        node = self.root.attachNewNode(PandaNode(object_id))
        node.setPos(*position)
        visual = node.attachNewNode(PandaNode(object_id + "-visual"))
        return SceneObject(object_id, title, description, node, visual, None, (0, 0, 0))

    def _register_existing(
        self,
        scene_object: SceneObject,
        half_extents: tuple[float, float, float],
        visual: Any | None = None,
    ) -> SceneObject:
        record = register_pickable(
            scene_object.node,
            object_id=scene_object.object_id,
            title=scene_object.title,
            description=scene_object.description,
            half_extents=half_extents,
            visual=visual if visual is not None else scene_object.visual,
        )
        self.objects[record.object_id] = record
        return record

    def _add_wall(
        self,
        object_id: str,
        title: str,
        description: str,
        position: tuple[float, float, float],
        size: tuple[float, float, float],
    ) -> SceneObject:
        from panda3d.core import PandaNode

        node = self.root.attachNewNode(PandaNode(object_id))
        node.setPos(*position)
        visual = node.attachNewNode(PandaNode(object_id + "-visual"))
        make_box(visual, object_id + "-panel", (0, 0, 0), size, (0.67, 0.72, 0.71, 1), specular=(0.2, 0.22, 0.22), shininess=24)
        return self._register_existing(
            SceneObject(object_id, title, description, node, visual, None, (0, 0, 0)),
            (size[0] / 2, size[1] / 2, size[2] / 2),
        )

    def _add_world_edge(
        self,
        name: str,
        position: tuple[float, float, float],
        size: tuple[float, float, float],
        color: tuple[float, float, float, float],
    ) -> None:
        make_box(self.root, name, position, size, color, specular=color[:3], shininess=30)

    def close(self) -> None:
        self.root.removeNode()
