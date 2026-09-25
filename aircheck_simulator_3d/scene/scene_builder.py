from __future__ import annotations

from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig
from aircheck_simulator_3d.scene.objects import SceneObject, add_world_label, make_box, register_pickable


class StandScene:
    """Builds the room, its outdoor context and labeled future-device zones."""

    def __init__(self, base: Any, config: SceneConfig) -> None:
        from panda3d.core import PandaNode

        self._base = base
        self.config = config
        self.root = base.render.attachNewNode(PandaNode("aircheck-stand"))
        self.objects: dict[str, SceneObject] = {}
        self.cutaway_wall: SceneObject
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
        make_box(floor.visual, "room-floor-finish", (0, 0, 0), (width, depth, 0.18), (0.48, 0.53, 0.52, 1), specular=(0.22, 0.24, 0.22), shininess=18)
        self._register_existing(floor, (width / 2, depth / 2, 0.1))

        outdoor_depth = self.config.outdoor_depth_m
        if outdoor_depth > 0:
            garden = self._entity(
                "environment.outdoor",
                "Наружный участок",
                "Условная внешняя среда для размещения наружного узла и показа окна.",
                (0, back_y + outdoor_depth / 2, -0.095),
            )
            make_box(garden.visual, "outdoor-ground", (0, 0, 0), (width + self.config.platform_margin_m * 2, outdoor_depth, 0.035), (0.25, 0.39, 0.31, 1), specular=(0.08, 0.12, 0.1), shininess=8)
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
        ceiling_visual = make_box(ceiling.visual, "room-ceiling-panel", (0, 0, 0), (width + thickness * 2, depth + thickness * 2, thickness), (0.78, 0.81, 0.79, 1), specular=(0.24, 0.25, 0.22), shininess=22)
        self._register_existing(ceiling, ((width + thickness * 2) / 2, (depth + thickness * 2) / 2, thickness / 2), ceiling_visual)

        window = self._add_window(back_y, floor_top)
        self.objects[window.object_id] = window

        self._add_ventilation_marker(
            "zone.ventilation.intake", "Зона приточной вентиляции", "INTAKE VENT",
            (-width / 2 + thickness * 0.55, depth * 0.20, floor_top + height * 0.73),
            (thickness * 1.9, 0.62, 0.48), (0.2, 0.76, 0.68, 1),
        )
        self._add_ventilation_marker(
            "zone.ventilation.exhaust", "Зона вытяжной вентиляции", "EXHAUST VENT",
            (width / 2 - thickness * 0.55, depth * 0.20, floor_top + height * 0.73),
            (thickness * 1.9, 0.62, 0.48), (0.95, 0.61, 0.28, 1),
        )
        self._add_zone(
            "zone.indoor-node", "Зона внутреннего узла", "INDOOR NODE",
            (-width * 0.24, -depth * 0.02, 1.25), (0.72, 0.6, 0.78), (0.26, 0.72, 0.92, 1),
            "Область будущего внутреннего измерительного узла. Здесь будут размещены устройства Milestone 3.",
        )
        self._add_zone(
            "zone.window-node", "Зона оконного узла", "WINDOW NODE",
            (self.config.window_width_m * 0.30, back_y - 0.36, floor_top + self.config.window_sill_height_m + self.config.window_height_m * 0.48),
            (0.48, 0.38, 0.44), (0.36, 0.84, 0.8, 1),
            "Место будущего оконного узла и сопряжения с рамой. Реальные датчики и привод здесь ещё не моделируются.",
        )
        self._add_zone(
            "zone.outdoor-node", "Зона наружного узла", "OUTDOOR NODE",
            (width * 0.18, back_y + min(outdoor_depth * 0.50, 1.1), 1.05),
            (0.66, 0.56, 0.72), (0.49, 0.79, 0.56, 1),
            "Область будущего наружного измерительного узла в наружной среде.",
        )
        self._add_zone(
            "zone.electronics", "Технический блок", "CONTROL ELECTRONICS",
            (width * 0.34, -depth * 0.24, 1.03), (0.9, 0.55, 1.18), (0.77, 0.58, 0.95, 1),
            "Область для будущего контроллера и силовой электроники. Компоненты пока представлены только зоной.",
        )

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

    def _add_window(self, back_y: float, floor_top: float) -> SceneObject:
        from panda3d.core import PandaNode, TransparencyAttrib

        width = self.config.window_width_m
        height = self.config.window_height_m
        sill = self.config.window_sill_height_m
        wall_t = self.config.wall_thickness_m
        frame = min(wall_t * 0.42, 0.065)
        window_center_z = floor_top + sill + height / 2
        wall_center_y = back_y + wall_t / 2

        # The rear wall is assembled around this real opening rather than covering the glass.
        below_height = sill
        above_height = self.config.room_height_m - sill - height
        side_width = (self.config.room_width_m - width) / 2
        wall_sections = (
            ((0, wall_center_y, floor_top + below_height / 2), (self.config.room_width_m, wall_t, below_height)),
            ((0, wall_center_y, floor_top + sill + height + above_height / 2), (self.config.room_width_m, wall_t, above_height)),
            ((-(width + side_width) / 2, wall_center_y, window_center_z), (side_width, wall_t, height)),
            (((width + side_width) / 2, wall_center_y, window_center_z), (side_width, wall_t, height)),
        )
        for index, (center, size) in enumerate(wall_sections):
            panel = make_box(self.root, f"back-wall-section-{index + 1}", center, size, (0.61, 0.69, 0.68, 1), specular=(0.18, 0.2, 0.19), shininess=20)
            panel.setName(f"back-wall-section-{index + 1}")

        node = self.root.attachNewNode(PandaNode("window-assembly"))
        node.setPos(0, wall_center_y, window_center_z)
        visual = node.attachNewNode(PandaNode("window-assembly-visual"))
        frame_color = (0.22, 0.29, 0.31, 1)
        pane = make_box(visual, "window-glass", (0, 0, 0), (width, wall_t * 0.4, height), (0.36, 0.72, 0.79, 0.34), specular=(0.52, 0.7, 0.76), shininess=78)
        pane.setTransparency(TransparencyAttrib.MAlpha)
        pane.setDepthWrite(False)
        pane.setBin("transparent", 10)
        frame_boxes = (
            ((-(width / 2 + frame / 2), 0, 0), (frame, wall_t * 0.9, height + frame * 2)),
            (((width / 2 + frame / 2), 0, 0), (frame, wall_t * 0.9, height + frame * 2)),
            ((0, 0, -(height / 2 + frame / 2)), (width + frame * 2, wall_t * 0.9, frame)),
            ((0, 0, (height / 2 + frame / 2)), (width + frame * 2, wall_t * 0.9, frame)),
            ((0, -wall_t * 0.18, 0), (frame * 0.72, wall_t, height)),
            ((0, -wall_t * 0.18, 0), (width, wall_t, frame * 0.72)),
        )
        for index, (center, size) in enumerate(frame_boxes):
            make_box(visual, f"window-frame-{index + 1}", center, size, frame_color, specular=(0.58, 0.62, 0.61), shininess=66)
        return self._register_existing(
            SceneObject(
                "window.assembly", "Окно и рама", "Оконный проём, стекло и рама; оконный узел пока не установлен.",
                node, visual, None, (0, 0, 0),
            ),
            (width / 2 + frame * 1.5, wall_t * 0.72, height / 2 + frame * 1.5),
        )

    def _add_zone(
        self,
        object_id: str,
        title: str,
        label: str,
        position: tuple[float, float, float],
        size: tuple[float, float, float],
        color: tuple[float, float, float, float],
        description: str,
    ) -> None:
        from panda3d.core import PandaNode

        node = self.root.attachNewNode(PandaNode(object_id))
        node.setPos(*position)
        visual = node.attachNewNode(PandaNode(object_id + "-outline"))
        edge = 0.035
        x, y, z = size
        bars = (
            ((0, -y / 2, -z / 2), (x, edge, edge)), ((0, y / 2, -z / 2), (x, edge, edge)),
            ((0, -y / 2, z / 2), (x, edge, edge)), ((0, y / 2, z / 2), (x, edge, edge)),
            ((-x / 2, 0, -z / 2), (edge, y, edge)), ((x / 2, 0, -z / 2), (edge, y, edge)),
            ((-x / 2, 0, z / 2), (edge, y, edge)), ((x / 2, 0, z / 2), (edge, y, edge)),
        )
        for index, (center, bar_size) in enumerate(bars):
            make_box(visual, f"{object_id}-edge-{index}", center, bar_size, color, specular=color[:3], shininess=38)
        make_box(visual, f"{object_id}-floor-marker", (0, 0, -z / 2 - 0.018), (x, y, 0.018), (*color[:3], 0.18), specular=color[:3], shininess=18)
        add_world_label(visual, label, (0, 0, z / 2 + 0.20), 0.12)
        self._register_existing(
            SceneObject(object_id, title, description, node, visual, None, (0, 0, 0)),
            (x / 2, y / 2, z / 2),
        )

    def _add_ventilation_marker(
        self,
        object_id: str,
        title: str,
        label: str,
        position: tuple[float, float, float],
        size: tuple[float, float, float],
        color: tuple[float, float, float, float],
    ) -> None:
        self._add_zone(
            object_id,
            title,
            label,
            position,
            size,
            color,
            f"Пустая зона для будущего монтажа: {title.lower()}. Это только пространственная метка, не модель устройства.",
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
