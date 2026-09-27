from __future__ import annotations

from pathlib import Path

from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.app.stand_layout import (
    CONTROL_CABINET_HEIGHT_M,
    CONTROL_CABINET_WIDTH_M,
    INDOOR_MOUNT_PANEL_HEIGHT_M,
    INDOOR_MOUNT_PANEL_WIDTH_M,
    EquipmentLayout,
)


CONFIG_DIR = Path(__file__).parents[1] / "config"


def test_web_stand_layout_places_nodes_on_opposite_wall_faces() -> None:
    scene = load_config(CONFIG_DIR, {}).scene
    layout = EquipmentLayout.from_config(scene)
    inner_wall_face = scene.room_depth_m / 2
    exterior_wall_face = inner_wall_face + scene.wall_thickness_m

    assert layout.indoor_sensor_center[0] < layout.control_cabinet_center[0]
    assert inner_wall_face - 0.10 < layout.indoor_sensor_center[1] < inner_wall_face
    assert layout.outdoor_station_center[1] > exterior_wall_face
    assert layout.control_cabinet_center[1] < inner_wall_face
    assert layout.trunk_z < scene.room_height_m
    assert layout.indoor_drop_x < layout.indoor_sensor_center[0]
    assert layout.controller_drop_x < layout.control_cabinet_center[0]


def test_mount_dimensions_for_browser_scene_are_positive_and_physical() -> None:
    assert 0 < INDOOR_MOUNT_PANEL_WIDTH_M < CONTROL_CABINET_WIDTH_M
    assert 0 < INDOOR_MOUNT_PANEL_HEIGHT_M < CONTROL_CABINET_HEIGHT_M
