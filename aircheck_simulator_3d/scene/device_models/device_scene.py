from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig
from aircheck_simulator_3d.scene.device_models.electronics import build_electronics_block
from aircheck_simulator_3d.scene.device_models.sensors import build_indoor_sensors, build_outdoor_sensors
from aircheck_simulator_3d.scene.device_models.ventilation import FanVisualRig, build_ventilation
from aircheck_simulator_3d.scene.device_models.window import WindowVisualRig, build_window_assembly
from aircheck_simulator_3d.scene.device_models.wiring import build_wire_routes
from aircheck_simulator_3d.scene.objects import SceneObject


@dataclass
class DeviceScene:
    objects: dict[str, SceneObject]
    window: WindowVisualRig
    fans: dict[str, FanVisualRig]


def build_device_scene(parent: Any, config: SceneConfig) -> DeviceScene:
    """Compose independent low-poly equipment assemblies and their routed wiring."""
    window = build_window_assembly(parent, config)
    indoor_objects, indoor_positions = build_indoor_sensors(parent, config)
    outdoor_objects, outdoor_positions = build_outdoor_sensors(parent, config)
    ventilation = build_ventilation(parent, config)
    electronics = build_electronics_block(parent, config)

    positions = {
        **indoor_positions,
        **outdoor_positions,
        **ventilation.positions,
        **electronics.positions,
    }
    window_center = tuple(window.rig.root.getPos(parent))
    build_wire_routes(parent, config, positions=positions, window_center=window_center)

    objects = {
        window.scene_object.object_id: window.scene_object,
        **window.extra_objects,
        **indoor_objects,
        **outdoor_objects,
        **ventilation.objects,
        **electronics.objects,
    }
    return DeviceScene(objects=objects, window=window.rig, fans=ventilation.fans)
