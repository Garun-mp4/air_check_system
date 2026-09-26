from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig


INDOOR_MOUNT_PANEL_DEPTH_M = 0.10
INDOOR_MOUNT_PANEL_WIDTH_M = 0.76
INDOOR_MOUNT_PANEL_HEIGHT_M = 0.86
OUTDOOR_BRACKET_STANDOFF_M = 0.18
CONTROL_CABINET_WIDTH_M = 1.55
CONTROL_CABINET_HEIGHT_M = 1.78
RACEWAY_DEPTH_M = 0.07
RACEWAY_HEIGHT_M = 0.12
RACEWAY_CEILING_CLEARANCE_M = 0.37
ESP32_PANEL_X_M = -0.39
ESP32_CABLE_EXIT_Z_M = 0.86


@dataclass(frozen=True)
class EquipmentLayout:
    """Shared wall-mount and cable-trunk coordinates for the equipment models."""

    indoor_sensor_center: tuple[float, float, float]
    outdoor_station_center: tuple[float, float, float]
    control_cabinet_center: tuple[float, float, float]
    controller_drop_x: float
    rear_channel_y: float
    rear_wire_y: float
    exterior_channel_y: float
    exterior_wire_y: float
    trunk_z: float
    exterior_entry_x: float
    outdoor_gland_x: float
    outdoor_gland_z: float
    indoor_drop_x: float

    @classmethod
    def from_config(cls, config: SceneConfig) -> EquipmentLayout:
        back_y = config.room_depth_m / 2
        exterior_wall_y = back_y + config.wall_thickness_m
        indoor_x = -config.room_width_m * 0.375
        outdoor_x = config.room_width_m * 0.26
        outdoor_z = config.room_height_m * 0.39
        control_x = config.room_width_m * 0.365
        control_y = back_y - config.wall_thickness_m / 2
        control_z = config.room_height_m * 0.3125
        raceway_center_y = back_y - RACEWAY_DEPTH_M / 2
        exterior_channel_y = exterior_wall_y + RACEWAY_DEPTH_M / 2
        outdoor_gland_x = outdoor_x - 0.35
        exterior_entry_x = config.window_width_m / 2 + config.wall_thickness_m / 2

        return cls(
            indoor_sensor_center=(
                indoor_x,
                back_y - INDOOR_MOUNT_PANEL_DEPTH_M / 2,
                config.room_height_m * 0.42,
            ),
            outdoor_station_center=(
                outdoor_x,
                exterior_wall_y + OUTDOOR_BRACKET_STANDOFF_M,
                outdoor_z,
            ),
            control_cabinet_center=(control_x, control_y, control_z),
            controller_drop_x=control_x + ESP32_PANEL_X_M,
            rear_channel_y=raceway_center_y,
            rear_wire_y=raceway_center_y - RACEWAY_DEPTH_M / 2 - 0.012,
            exterior_channel_y=exterior_channel_y,
            exterior_wire_y=exterior_channel_y + RACEWAY_DEPTH_M / 2 + 0.015,
            trunk_z=config.room_height_m - RACEWAY_CEILING_CLEARANCE_M,
            exterior_entry_x=exterior_entry_x,
            outdoor_gland_x=outdoor_gland_x,
            outdoor_gland_z=outdoor_z - 0.39,
            indoor_drop_x=indoor_x - 0.43,
        )


def world_position(node: Any, parent: Any) -> tuple[float, float, float]:
    position = node.getPos(parent)
    return (float(position.getX()), float(position.getY()), float(position.getZ()))
