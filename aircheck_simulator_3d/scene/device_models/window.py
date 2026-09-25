from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig
from aircheck_simulator_3d.scene.device_models.geometry import create_pickable_part, make_cylinder
from aircheck_simulator_3d.scene.objects import SceneObject, make_box, register_pickable


@dataclass
class WindowVisualRig:
    root: Any
    sash_pivot: Any
    open_angle_degrees: float
    actuator_rod: Any
    actuator_fixed_anchor: tuple[float, float, float]
    actuator_moving_anchor: tuple[float, float, float]
    actuator_rod_radius: float
    reed_indicator: Any
    open_limit_indicator: Any
    close_limit_indicator: Any
    motor_indicator: Any


@dataclass
class WindowAssembly:
    scene_object: SceneObject
    extra_objects: dict[str, SceneObject]
    rig: WindowVisualRig


def build_window_assembly(parent: Any, config: SceneConfig) -> WindowAssembly:
    from panda3d.core import PandaNode, TransparencyAttrib

    width = config.window_width_m
    height = config.window_height_m
    wall_t = config.wall_thickness_m
    sill = config.window_sill_height_m
    back_y = config.room_depth_m / 2
    floor_top = 0.04
    center_z = floor_top + sill + height / 2
    frame = min(wall_t * 0.42, 0.065)
    sash_width = width - 2 * frame
    sash_height = height - 2 * frame
    wall_center_y = back_y + wall_t / 2
    above_height = config.room_height_m - sill - height
    side_width = (config.room_width_m - width) / 2
    rear_sections = (
        ((0, wall_center_y, floor_top + sill / 2), (config.room_width_m, wall_t, sill)),
        ((0, wall_center_y, floor_top + sill + height + above_height / 2), (config.room_width_m, wall_t, above_height)),
        ((-(width + side_width) / 2, wall_center_y, center_z), (side_width, wall_t, height)),
        (((width + side_width) / 2, wall_center_y, center_z), (side_width, wall_t, height)),
    )
    for index, (position, size) in enumerate(rear_sections):
        make_box(parent, f"rear-wall-section-{index + 1}", position, size, (0.61, 0.69, 0.68, 1), specular=(0.18, 0.2, 0.19), shininess=20)
    assembly = parent.attachNewNode(PandaNode("window-assembly"))
    assembly.setPos(0, back_y + wall_t / 2, center_z)
    visual = assembly.attachNewNode(PandaNode("window-assembly-visual"))

    # Fixed architectural frame and sill.
    frame_color = (0.19, 0.26, 0.29, 1)
    frame_parts = (
        ((-(width / 2 + frame / 2), 0, 0), (frame, wall_t * 0.94, height + frame * 2)),
        (((width / 2 + frame / 2), 0, 0), (frame, wall_t * 0.94, height + frame * 2)),
        ((0, 0, -(height / 2 + frame / 2)), (width + frame * 2, wall_t * 1.1, frame)),
        ((0, 0, (height / 2 + frame / 2)), (width + frame * 2, wall_t * 1.1, frame)),
        ((0, -wall_t * 0.12, 0), (frame * 0.58, wall_t, height)),
    )
    for index, (position, size) in enumerate(frame_parts):
        make_box(visual, f"window-fixed-frame-{index + 1}", position, size, frame_color, specular=(0.55, 0.61, 0.62), shininess=70)
    make_box(visual, "window-interior-sill", (0, -wall_t * 0.65, -height / 2 - frame * 0.12), (width + frame * 1.6, wall_t * 1.8, frame * 0.65), (0.55, 0.61, 0.59, 1), specular=(0.3, 0.34, 0.33), shininess=30)

    # The glazed sash pivots around its left vertical hinge instead of swapping models.
    sash_pivot = assembly.attachNewNode(PandaNode("window-sash-pivot"))
    sash_pivot.setPos(-width / 2 + frame, -wall_t * 0.18, 0)
    sash_visual = sash_pivot.attachNewNode(PandaNode("window-movable-sash"))
    pane = make_box(
        sash_visual,
        "window-movable-glass",
        (sash_width / 2, 0, 0),
        (sash_width, wall_t * 0.30, sash_height),
        (0.30, 0.66, 0.76, 0.30),
        specular=(0.62, 0.76, 0.82),
        shininess=86,
    )
    pane.setTransparency(TransparencyAttrib.MAlpha)
    pane.setDepthWrite(False)
    pane.setBin("transparent", 10)
    sash_frame = (
        ((sash_width / 2, -wall_t * 0.13, -sash_height / 2 - frame / 2), (sash_width + frame, frame, frame)),
        ((sash_width / 2, -wall_t * 0.13, sash_height / 2 + frame / 2), (sash_width + frame, frame, frame)),
        ((sash_width + frame / 2, -wall_t * 0.13, 0), (frame, frame, sash_height)),
        ((frame / 2, -wall_t * 0.13, 0), (frame, frame, sash_height)),
    )
    for index, (position, size) in enumerate(sash_frame):
        make_box(sash_visual, f"window-sash-rail-{index + 1}", position, size, (0.28, 0.36, 0.38, 1), specular=(0.5, 0.58, 0.6), shininess=62)

    # Three hinge knuckles make the vertical pivot obvious from a close view.
    hinge_x = -width / 2 + frame * 0.52
    for index, z in enumerate((-height * 0.34, 0, height * 0.34)):
        make_cylinder(visual, f"window-hinge-{index + 1}", (hinge_x, -wall_t * 0.26, z), frame * 0.22, height * 0.14, (0.72, 0.76, 0.72, 1), axis="z", segments=12)

    main = register_pickable(
        assembly,
        object_id="window.assembly",
        title="Оконная створка и рама",
        description="Створка установлена на вертикальных петлях. Её угол следует за actual_position из Device Layer; рядом установлены привод, магнитный датчик и концевики.",
        half_extents=(width / 2 + frame * 1.5, wall_t * 0.25, height / 2 + frame * 1.7),
        visual=visual,
    )

    # Reed sensor and its magnet are independently selectable and visibly mounted to sash/frame.
    reed_obj, reed_visual = create_pickable_part(
        assembly,
        object_id="window.reed_switch",
        title="Геркон оконного узла",
        description="Виртуальный магнитный датчик сообщает состояние, рассчитанное Device Layer по фактическому положению створки.",
        position=(width / 2 - frame * 0.48, -wall_t * 1.20, height * 0.22),
        half_extents=(0.075, 0.045, 0.055),
    )
    make_box(reed_visual, "reed-switch-body", (0, 0, 0), (0.14, 0.055, 0.09), (0.2, 0.26, 0.28, 1), specular=(0.38, 0.44, 0.45), shininess=40)
    reed_indicator = make_box(reed_visual, "reed-switch-indicator", (0, -0.033, 0.052), (0.044, 0.014, 0.026), (0.21, 0.24, 0.24, 1))

    magnet = sash_pivot.attachNewNode(PandaNode("window-magnet"))
    magnet.setPos(sash_width - frame * 0.4, -wall_t * 0.95, height * 0.22)
    make_box(magnet, "window-magnet-body", (0, 0, 0), (0.085, 0.048, 0.075), (0.78, 0.39, 0.2, 1), specular=(0.54, 0.42, 0.34), shininess=38)
    magnet_obj = register_pickable(
        magnet,
        object_id="window.magnet",
        title="Магнит створки",
        description="Магнит, установленный на движущейся оконной створке напротив геркона.",
        half_extents=(0.05, 0.03, 0.045),
    )

    open_obj, open_visual = create_pickable_part(
        assembly,
        object_id="window.limit_open",
        title="Концевик полного открытия",
        description="Виртуальный концевой выключатель активируется при actual_position = 100%; Device Layer останавливает привод.",
        position=(width / 2 + frame * 0.52, -wall_t * 1.18, height * 0.40),
        half_extents=(0.065, 0.045, 0.055),
    )
    make_box(open_visual, "open-limit-switch-body", (0, 0, 0), (0.12, 0.052, 0.10), (0.24, 0.29, 0.30, 1))
    open_indicator = make_box(open_visual, "open-limit-indicator", (0, -0.032, 0.055), (0.045, 0.014, 0.024), (0.22, 0.24, 0.24, 1))

    close_obj, close_visual = create_pickable_part(
        assembly,
        object_id="window.limit_close",
        title="Концевик полного закрытия",
        description="Виртуальный концевой выключатель активируется при actual_position = 0%; Device Layer останавливает привод.",
        position=(-width / 2 - frame * 0.52, -wall_t * 1.18, -height * 0.40),
        half_extents=(0.065, 0.045, 0.055),
    )
    make_box(close_visual, "close-limit-switch-body", (0, 0, 0), (0.12, 0.052, 0.10), (0.24, 0.29, 0.30, 1))
    close_indicator = make_box(close_visual, "close-limit-indicator", (0, -0.032, 0.055), (0.045, 0.014, 0.024), (0.22, 0.24, 0.24, 1))

    actuator_obj, actuator_visual = create_pickable_part(
        assembly,
        object_id="window.actuator",
        title="Линейный привод окна",
        description="12 V линейный привод с механической тягой. Состояние мотора и движение створки следуют за Device Layer.",
        position=(-width * 0.19, -wall_t * 0.86, -height * 0.38),
        half_extents=(0.23, 0.10, 0.12),
    )
    make_box(actuator_visual, "actuator-motor-housing", (0, 0, 0), (0.40, 0.17, 0.18), (0.28, 0.33, 0.35, 1), specular=(0.54, 0.59, 0.59), shininess=64)
    make_cylinder(actuator_visual, "actuator-motor-cap", (0.15, 0, 0), 0.09, 0.09, (0.58, 0.63, 0.61, 1), axis="x", segments=16)
    motor_indicator = make_box(actuator_visual, "actuator-status-indicator", (-0.12, -0.093, 0.07), (0.055, 0.016, 0.03), (0.22, 0.24, 0.24, 1))

    fixed_anchor = (-width * 0.25, -wall_t * 1.0, -height * 0.34)
    moving_anchor = (sash_width * 0.84, -wall_t * 0.32, -height * 0.34)
    rod = make_cylinder(assembly, "window-actuator-linkage", fixed_anchor, 1.0, 1.0, (0.69, 0.73, 0.70, 1), axis="y", segments=12)
    rod.setScale(0.024, 0.8, 0.024)
    make_cylinder(assembly, "window-link-frame-pivot", fixed_anchor, 0.045, 0.10, (0.46, 0.51, 0.51, 1), axis="y", segments=12)
    linkage_tip = sash_pivot.attachNewNode(PandaNode("window-linkage-sash-pivot"))
    linkage_tip.setPos(*moving_anchor)
    make_cylinder(linkage_tip, "window-linkage-sash-joint", (0, 0, 0), 0.042, 0.09, (0.46, 0.51, 0.51, 1), axis="y", segments=12)

    extra = {
        obj.object_id: obj
        for obj in (reed_obj, magnet_obj, open_obj, close_obj, actuator_obj)
    }
    rig = WindowVisualRig(
        root=assembly,
        sash_pivot=sash_pivot,
        open_angle_degrees=config.window_open_angle_degrees,
        actuator_rod=rod,
        actuator_fixed_anchor=fixed_anchor,
        actuator_moving_anchor=moving_anchor,
        actuator_rod_radius=0.024,
        reed_indicator=reed_indicator,
        open_limit_indicator=open_indicator,
        close_limit_indicator=close_indicator,
        motor_indicator=motor_indicator,
    )
    return WindowAssembly(main, extra, rig)
