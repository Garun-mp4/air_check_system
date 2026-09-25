from __future__ import annotations

from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig
from aircheck_simulator_3d.scene.device_models.geometry import (
    add_louver_panel,
    add_mounting_panel,
    create_pickable_part,
    make_cylinder,
)
from aircheck_simulator_3d.scene.objects import SceneObject, add_world_label, make_box


INDOOR_SENSOR = "sensor.scd41.indoor"
INDOOR_PARTICLE = "sensor.sps30.indoor"
OUTDOOR_CLIMATE = "sensor.sht45.outdoor"
OUTDOOR_PARTICLE = "sensor.sps30.outdoor"


def build_indoor_sensors(parent: Any, config: SceneConfig) -> tuple[dict[str, SceneObject], dict[str, tuple[float, float, float]]]:
    from panda3d.core import PandaNode

    center = (-config.room_width_m * 0.26, -config.room_depth_m * 0.17, 1.53)
    assembly = parent.attachNewNode(PandaNode("indoor-sensor-assembly"))
    assembly.setPos(*center)
    add_mounting_panel(assembly, name="indoor-sensor-mount", size=(0.76, 0.10, 0.86), color=(0.2, 0.31, 0.33, 1))
    make_box(assembly, "indoor-sensor-spacer", (0, -0.082, 0), (0.68, 0.05, 0.76), (0.74, 0.77, 0.71, 1), specular=(0.32, 0.34, 0.31), shininess=24)

    scd_obj, scd = create_pickable_part(
        assembly,
        object_id=INDOOR_SENSOR,
        title="Sensirion SCD41 · внутренний",
        description="Модуль измерения CO2, температуры и влажности воздуха в комнате. Установлен на вентилируемом внутреннем кронштейне.",
        position=(-0.17, -0.125, 0.24),
        half_extents=(0.21, 0.08, 0.12),
    )
    make_box(scd, "scd41-board", (0, 0, 0), (0.40, 0.12, 0.22), (0.08, 0.42, 0.36, 1), specular=(0.38, 0.54, 0.43), shininess=48)
    make_box(scd, "scd41-sensor-cap", (-0.035, -0.07, 0.01), (0.18, 0.035, 0.12), (0.84, 0.84, 0.78, 1), specular=(0.3, 0.33, 0.32), shininess=22)
    make_box(scd, "scd41-connector", (0.16, 0, -0.068), (0.09, 0.13, 0.04), (0.9, 0.65, 0.21, 1))
    for index in range(5):
        make_box(scd, f"scd41-air-slot-{index + 1}", (-0.16 + index * 0.075, -0.092, 0.095), (0.042, 0.012, 0.02), (0.13, 0.19, 0.19, 1))

    sps_obj, sps = create_pickable_part(
        assembly,
        object_id=INDOOR_PARTICLE,
        title="Sensirion SPS30 · внутренний",
        description="Лазерный сенсор частиц PM1.0–PM10. Воздух поступает через входную решётку корпуса; выходная сторона остаётся открытой для вентиляции.",
        position=(0.18, -0.14, -0.20),
        half_extents=(0.22, 0.11, 0.23),
    )
    make_box(sps, "sps30-case", (0, 0, 0), (0.42, 0.18, 0.44), (0.78, 0.78, 0.70, 1), specular=(0.42, 0.44, 0.4), shininess=34)
    make_box(sps, "sps30-front-inlet", (0, -0.099, 0.015), (0.28, 0.025, 0.28), (0.24, 0.3, 0.29, 1))
    add_louver_panel(sps, name="sps30-intake", width=0.23, height=0.22, y=-0.116, count=6)
    make_box(sps, "sps30-status-light", (0.15, -0.104, 0.16), (0.035, 0.02, 0.035), (0.25, 0.9, 0.65, 1))
    make_box(assembly, "sensor-cable-anchor", (0.35, -0.09, -0.32), (0.14, 0.07, 0.08), (0.22, 0.28, 0.29, 1))
    make_cylinder(assembly, "sensor-mount-post", (0, 0.11, 0), 0.024, 0.68, (0.53, 0.59, 0.57, 1), axis="z")
    add_world_label(assembly, "INDOOR SENSORS", (0, -0.10, 0.57), 0.09)
    return (
        {INDOOR_SENSOR: scd_obj, INDOOR_PARTICLE: sps_obj},
        {INDOOR_SENSOR: (*center[:2], center[2] + 0.24), INDOOR_PARTICLE: (*center[:2], center[2] - 0.20)},
    )


def build_outdoor_sensors(
    parent: Any, config: SceneConfig
) -> tuple[dict[str, SceneObject], dict[str, tuple[float, float, float]]]:
    from panda3d.core import PandaNode

    center = (config.room_width_m * 0.26, config.room_depth_m / 2 + min(config.outdoor_depth_m * 0.39, 1.45), 1.48)
    assembly = parent.attachNewNode(PandaNode("outdoor-weather-station"))
    assembly.setPos(*center)
    make_cylinder(assembly, "outdoor-pole", (0, 0.14, -0.25), 0.038, 1.36, (0.31, 0.37, 0.38, 1), axis="z", segments=12)
    make_box(assembly, "outdoor-backplate", (0, 0.105, 0.09), (0.66, 0.08, 0.94), (0.66, 0.71, 0.66, 1), specular=(0.35, 0.38, 0.32), shininess=28)
    # The broad hood sheds rain while the separated louvres keep the sensor volume ventilated.
    make_box(assembly, "outdoor-weather-hood", (0, -0.04, 0.51), (0.86, 0.40, 0.10), (0.78, 0.81, 0.74, 1), specular=(0.4, 0.42, 0.37), shininess=40)
    make_box(assembly, "outdoor-weather-base", (0, -0.02, -0.47), (0.80, 0.34, 0.08), (0.71, 0.75, 0.68, 1))
    for x in (-0.40, 0.40):
        make_box(assembly, f"outdoor-shield-side-{x}", (x, -0.02, 0.02), (0.06, 0.34, 0.88), (0.72, 0.76, 0.7, 1))
    for index in range(5):
        z = -0.30 + index * 0.13
        make_box(assembly, f"outdoor-shield-louvre-{index + 1}", (0, -0.19, z), (0.70, 0.035, 0.035), (0.43, 0.52, 0.51, 1), specular=(0.32, 0.4, 0.38), shininess=30)

    sht_obj, sht = create_pickable_part(
        assembly,
        object_id=OUTDOOR_CLIMATE,
        title="Sensirion SHT45 · наружный",
        description="Наружный датчик температуры и влажности под козырьком в вентилируемом погодозащитном экране.",
        position=(0.15, -0.10, 0.25),
        half_extents=(0.15, 0.095, 0.09),
    )
    make_box(sht, "sht45-board", (0, 0, 0), (0.29, 0.045, 0.16), (0.1, 0.43, 0.34, 1), specular=(0.42, 0.52, 0.42), shininess=42)
    make_box(sht, "sht45-package", (-0.015, -0.031, 0.006), (0.10, 0.025, 0.075), (0.86, 0.84, 0.72, 1))
    make_box(sht, "sht45-connector", (0.115, -0.02, -0.04), (0.06, 0.055, 0.032), (0.88, 0.63, 0.23, 1))

    sps_obj, sps = create_pickable_part(
        assembly,
        object_id=OUTDOOR_PARTICLE,
        title="Sensirion SPS30 · наружный",
        description="Наружный сенсор мелкодисперсных частиц внутри вентилируемого защитного корпуса; установлен на отдельном кронштейне.",
        position=(-0.08, -0.10, -0.19),
        half_extents=(0.23, 0.11, 0.21),
    )
    make_box(sps, "outdoor-sps30-case", (0, 0, 0), (0.44, 0.18, 0.40), (0.74, 0.76, 0.68, 1), specular=(0.42, 0.44, 0.4), shininess=34)
    make_box(sps, "outdoor-sps30-inlet", (0, -0.10, 0.015), (0.28, 0.025, 0.27), (0.24, 0.3, 0.29, 1))
    add_louver_panel(sps, name="outdoor-sps30-louvre", width=0.23, height=0.23, y=-0.117, count=6)
    make_box(sps, "outdoor-sps30-exhaust", (0, 0.096, -0.02), (0.27, 0.02, 0.27), (0.28, 0.36, 0.35, 1))
    for index in range(5):
        make_box(sps, f"outdoor-sps30-exhaust-slot-{index + 1}", (0, 0.108, -0.11 + index * 0.055), (0.21, 0.012, 0.018), (0.51, 0.59, 0.55, 1))

    # A side-entry gland and a restrained cable loop lead the data bundle back indoors.
    make_cylinder(assembly, "outdoor-cable-gland", (0.35, -0.10, -0.39), 0.055, 0.09, (0.18, 0.23, 0.24, 1), axis="y", segments=12)
    add_world_label(assembly, "OUTDOOR SENSORS", (0, -0.12, 0.70), 0.09)
    return (
        {OUTDOOR_CLIMATE: sht_obj, OUTDOOR_PARTICLE: sps_obj},
        {OUTDOOR_CLIMATE: (center[0] + 0.15, center[1] - 0.10, center[2] + 0.25), OUTDOOR_PARTICLE: (center[0] - 0.08, center[1] - 0.10, center[2] - 0.19)},
    )
