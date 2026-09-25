from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig
from aircheck_simulator_3d.scene.device_models.geometry import create_pickable_part, make_cylinder
from aircheck_simulator_3d.scene.objects import SceneObject, add_world_label, make_box


@dataclass
class FanVisualRig:
    rotor: Any
    status_indicator: Any


@dataclass
class VentilationAssembly:
    objects: dict[str, SceneObject]
    fans: dict[str, FanVisualRig]
    positions: dict[str, tuple[float, float, float]]


def build_ventilation(parent: Any, config: SceneConfig) -> VentilationAssembly:
    width, depth, height = config.room_width_m, config.room_depth_m, config.room_height_m
    center_z = height * 0.73
    y = depth / 2 - config.wall_thickness_m * 0.45
    intake_position = (-width * 0.37, y, center_z)
    exhaust_position = (width * 0.37, y, center_z)
    objects: dict[str, SceneObject] = {}
    fans: dict[str, FanVisualRig] = {}

    for role, position in (("intake", intake_position), ("exhaust", exhaust_position)):
        is_intake = role == "intake"
        object_id = f"fan.{role}"
        title = "Приточный вентилятор" if is_intake else "Вытяжной вентилятор"
        description = (
            "Вентилятор приточного канала. Путь воздуха показан как OUTSIDE → FILTER → ROOM; вращение лопастей следует за состоянием intake в Device Layer."
            if is_intake else
            "Вентилятор вытяжного канала. Путь воздуха показан как ROOM → OUTSIDE; вращение лопастей следует за состоянием exhaust в Device Layer."
        )
        part, visual = create_pickable_part(
            parent,
            object_id=object_id,
            title=title,
            description=description,
            position=position,
            half_extents=(0.38, 0.20, 0.38),
        )
        objects[object_id] = part
        radius = 0.30

        # The duct passes through the rear wall; the filter and exterior grille are on its outdoor side.
        make_box(visual, f"{role}-duct-room", (0, -0.44, 0), (0.43, 0.72, 0.43), (0.34, 0.41, 0.42, 1), specular=(0.28, 0.32, 0.34), shininess=26)
        make_box(visual, f"{role}-duct-collar", (0, 0.18, 0), (0.51, 0.12, 0.51), (0.55, 0.61, 0.58, 1), specular=(0.43, 0.48, 0.45), shininess=38)
        make_box(visual, f"{role}-outer-grille", (0, 0.66, 0), (0.48, 0.12, 0.48), (0.2, 0.29, 0.3, 1), specular=(0.4, 0.45, 0.45), shininess=34)
        for index in range(5):
            x = -0.18 + index * 0.09
            make_box(visual, f"{role}-grille-slats-{index + 1}", (x, 0.59, 0), (0.022, 0.035, 0.40), (0.65, 0.71, 0.68, 1))

        if is_intake:
            make_box(visual, "intake-filter-frame", (0, 0.38, 0), (0.48, 0.16, 0.48), (0.22, 0.32, 0.3, 1))
            for index in range(7):
                x = -0.17 + index * 0.056
                make_box(visual, f"intake-filter-pleat-{index + 1}", (x, 0.29, 0), (0.026, 0.035, 0.35), (0.72, 0.76, 0.63, 1))
            add_world_label(visual, "OUTSIDE > FILTER > ROOM", (0, 0.74, -0.37), 0.074)
        else:
            add_world_label(visual, "ROOM > OUTSIDE", (0, 0.74, -0.37), 0.08)

        make_cylinder(visual, f"{role}-fan-motor", (0, -0.29, 0), radius * 0.77, 0.22, (0.14, 0.2, 0.22, 1), axis="y", segments=20)
        rotor = visual.attachNewNode(f"{role}-rotor")
        rotor.setPos(0, -0.18, 0)
        make_cylinder(rotor, f"{role}-fan-hub", (0, 0, 0), radius * 0.22, 0.12, (0.68, 0.73, 0.7, 1), axis="y", segments=16)
        for blade_index in range(3):
            blade = make_box(
                rotor,
                f"{role}-fan-blade-{blade_index + 1}",
                (0, -0.078, radius * 0.37),
                (radius * 0.36, 0.035, radius * 0.77),
                (0.41, 0.73, 0.69, 1) if is_intake else (0.88, 0.57, 0.29, 1),
                specular=(0.46, 0.55, 0.51),
                shininess=50,
            )
            blade.setR(blade_index * 120)
        # Four slim guards sit outside the rotor's swept area.
        for index, (center, size) in enumerate((
            ((0, -0.126, -radius), (radius * 2.0, 0.024, 0.045)),
            ((0, -0.126, radius), (radius * 2.0, 0.024, 0.045)),
            ((-radius, -0.126, 0), (0.045, 0.024, radius * 2.0)),
            ((radius, -0.126, 0), (0.045, 0.024, radius * 2.0)),
        )):
            make_box(visual, f"{role}-fan-safety-guard-{index + 1}", center, size, (0.62, 0.67, 0.65, 1), specular=(0.45, 0.48, 0.46), shininess=40)
        indicator = make_box(visual, f"{role}-fan-status", (radius * 0.78, -0.14, radius * 0.82), (0.055, 0.025, 0.055), (0.2, 0.24, 0.23, 1))
        fans[role] = FanVisualRig(rotor=rotor, status_indicator=indicator)
        add_world_label(visual, "INTAKE FAN" if is_intake else "EXHAUST FAN", (0, -0.02, radius + 0.14), 0.095)

    return VentilationAssembly(
        objects=objects,
        fans=fans,
        positions={"fan.intake": intake_position, "fan.exhaust": exhaust_position},
    )
