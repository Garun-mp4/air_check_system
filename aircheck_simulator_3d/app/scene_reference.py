from dataclasses import asdict
from aircheck_simulator_3d.app.config import AppConfig
from aircheck_simulator_3d.app.stand_layout import (
    CONTROL_CABINET_HEIGHT_M,
    CONTROL_CABINET_WIDTH_M,
    INDOOR_MOUNT_PANEL_HEIGHT_M,
    INDOOR_MOUNT_PANEL_WIDTH_M,
    EquipmentLayout,
)


def scene_reference(config: AppConfig) -> dict:
    """Static geometry shared with the real browser viewer; no physics or network."""
    return {
        "room_volume_m3": config.room.volume_m3,
        "room_dimensions": {
            "width_m": config.scene.room_width_m,
            "depth_m": config.scene.room_depth_m,
            "height_m": config.scene.room_height_m,
            "wall_thickness_m": config.scene.wall_thickness_m,
            "window_width_m": config.scene.window_width_m,
            "window_height_m": config.scene.window_height_m,
            "window_sill_height_m": config.scene.window_sill_height_m,
            "window_open_angle_degrees": config.scene.window_open_angle_degrees,
            "outdoor_depth_m": config.scene.outdoor_depth_m,
        },
        "layout": asdict(EquipmentLayout.from_config(config.scene)),
        "mount_dimensions": {
            "control_cabinet_width_m": CONTROL_CABINET_WIDTH_M,
            "control_cabinet_height_m": CONTROL_CABINET_HEIGHT_M,
            "indoor_panel_width_m": INDOOR_MOUNT_PANEL_WIDTH_M,
            "indoor_panel_height_m": INDOOR_MOUNT_PANEL_HEIGHT_M,
        },
        "camera": {
            "start_position": list(config.camera.start_position),
            "start_target": list(config.camera.start_target),
            "move_speed_m_s": config.camera.move_speed_m_s,
            "fast_move_multiplier": config.camera.fast_move_multiplier,
            "mouse_sensitivity": config.camera.mouse_sensitivity,
            "wheel_step_m": config.camera.wheel_step_m,
            "transition_seconds": config.camera.transition_seconds,
            "min_pitch_degrees": config.camera.min_pitch_degrees,
            "max_pitch_degrees": config.camera.max_pitch_degrees,
            "field_of_view_degrees": config.camera.field_of_view_degrees,
            "near_plane_m": config.camera.near_plane_m,
            "far_plane_m": config.camera.far_plane_m,
            "focus_distance_min_m": config.camera.focus_distance_min_m,
        },
    }
