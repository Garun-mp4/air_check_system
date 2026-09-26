from __future__ import annotations

import math
from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig
from aircheck_simulator_3d.scene.device_models.geometry import add_cable, add_label, make_cylinder
from aircheck_simulator_3d.scene.device_models.layout import (
    CONTROL_CABINET_HEIGHT_M,
    INDOOR_MOUNT_PANEL_HEIGHT_M,
    RACEWAY_DEPTH_M,
    RACEWAY_HEIGHT_M,
    EquipmentLayout,
)
from aircheck_simulator_3d.scene.objects import make_box


POWER = (0.88, 0.20, 0.16, 1)
GROUND = (0.18, 0.23, 0.25, 1)
SENSOR_BUS = (0.06, 0.55, 0.78, 1)
CONTROL = (0.9, 0.59, 0.13, 1)
RACEWAY = (0.34, 0.40, 0.41, 1)
CONTROL_PANEL_COMPONENTS = frozenset({
    "device.esp32",
    "power.psu_12v",
    "power.dc_dc",
    "power.mosfet_module",
    "power.h_bridge",
    "power.terminal_blocks",
})


def build_wire_routes(
    parent: Any,
    config: SceneConfig,
    *,
    positions: dict[str, tuple[float, float, float]],
    window_center: tuple[float, float, float],
) -> None:
    """Route low-voltage wiring on wall raceways between mounted equipment."""
    layout = EquipmentLayout.from_config(config)
    _build_wall_raceways(parent, config, layout, positions)

    psu = positions["power.psu_12v"]
    dc = positions["power.dc_dc"]
    esp = positions["device.esp32"]
    esp_exit = positions["wire.esp32_exit"]
    mosfet = positions["power.mosfet_module"]
    hbridge = positions["power.h_bridge"]
    terminal = positions["power.terminal_blocks"]
    intake = positions["fan.intake"]
    exhaust = positions["fan.exhaust"]
    actuator = positions.get("window.actuator", window_center)
    indoor_climate = positions["sensor.scd41.indoor"]
    indoor_particles = positions["sensor.sps30.indoor"]
    outdoor_climate = positions["sensor.sht45.outdoor"]
    outdoor_particles = positions["sensor.sps30.outdoor"]
    indoor_bundle = _midpoint(indoor_climate, indoor_particles)
    outdoor_bundle = _midpoint(outdoor_climate, outdoor_particles)

    # The controller's short pigtail feeds individual signal lines into the wall trunk.
    _draw_wire(
        parent,
        "data-esp32-outgoing-harness",
        (esp, esp_exit),
        SENSOR_BUS,
        source_id="device.esp32",
        target_id="wire.esp32_exit",
        wire_type="sensor_data",
        thickness=3.4,
    )

    power_routes = (
        ("power-12v-intake", "power.psu_12v", psu, "fan.intake", intake, False),
        ("power-12v-exhaust", "power.psu_12v", psu, "fan.exhaust", exhaust, False),
        ("power-12v-h-bridge", "power.psu_12v", psu, "power.h_bridge", hbridge, False),
        ("power-h-bridge-window-actuator", "power.h_bridge", hbridge, "window.actuator", actuator, False),
        ("power-12v-dc-dc", "power.psu_12v", psu, "power.dc_dc", dc, False),
        ("power-5v-esp32", "power.dc_dc", dc, "device.esp32", esp, False),
        ("power-5v-indoor-sensors", "power.dc_dc", dc, "sensor.group.indoor", indoor_bundle, False),
        ("power-5v-outdoor-sensors", "power.dc_dc", dc, "sensor.group.outdoor", outdoor_bundle, True),
    )
    for index, (name, source_id, source, target_id, target, exterior) in enumerate(power_routes):
        _draw_device_route(
            parent, name, source, target, layout, config, window_center,
            positions=positions, color=POWER,
            source_id=source_id, target_id=target_id,
            wire_type="power", lane=_lane(index, len(power_routes)), exterior=exterior,
        )

    ground_routes = (
        ("ground-intake", "power.terminal_blocks", terminal, "fan.intake", intake, False),
        ("ground-exhaust", "power.terminal_blocks", terminal, "fan.exhaust", exhaust, False),
        ("ground-window-actuator", "power.terminal_blocks", terminal, "window.actuator", actuator, False),
        ("ground-esp32", "power.terminal_blocks", terminal, "device.esp32", esp, False),
        ("ground-indoor-sensors", "power.terminal_blocks", terminal, "sensor.group.indoor", indoor_bundle, False),
        ("ground-outdoor-sensors", "power.terminal_blocks", terminal, "sensor.group.outdoor", outdoor_bundle, True),
    )
    for index, (name, source_id, source, target_id, target, exterior) in enumerate(ground_routes):
        _draw_device_route(
            parent, name, source, target, layout, config, window_center,
            positions=positions, color=GROUND,
            source_id=source_id, target_id=target_id,
            wire_type="ground", lane=_lane(index, len(ground_routes)), exterior=exterior,
        )

    sensor_routes = (
        ("i2c-indoor-climate", "sensor.scd41.indoor", indoor_climate, False),
        ("uart-indoor-particles", "sensor.sps30.indoor", indoor_particles, False),
        ("i2c-outdoor-climate", "sensor.sht45.outdoor", outdoor_climate, True),
        ("uart-outdoor-particles", "sensor.sps30.outdoor", outdoor_particles, True),
    )
    for index, (name, target_id, target, exterior) in enumerate(sensor_routes):
        _draw_device_route(
            parent, name, esp_exit, target, layout, config, window_center,
            positions=positions, color=SENSOR_BUS,
            source_id="device.esp32", target_id=target_id,
            wire_type="i2c" if name.startswith("i2c-") else "uart",
            lane=_lane(index, len(sensor_routes)), exterior=exterior,
        )

    control_routes = (
        ("control-esp32-mosfet", "device.esp32", esp, "power.mosfet_module", mosfet, False),
        ("control-esp32-hbridge", "device.esp32", esp, "power.h_bridge", hbridge, False),
        ("control-mosfet-intake", "power.mosfet_module", mosfet, "fan.intake", intake, False),
        ("control-mosfet-exhaust", "power.mosfet_module", mosfet, "fan.exhaust", exhaust, False),
        ("control-hbridge-window-actuator", "power.h_bridge", hbridge, "window.actuator", actuator, False),
        ("control-esp32-reed-switch", "device.esp32", esp, "window.reed_switch", positions["window.reed_switch"], False),
        ("control-esp32-open-limit", "device.esp32", esp, "window.limit_open", positions["window.limit_open"], False),
        ("control-esp32-close-limit", "device.esp32", esp, "window.limit_close", positions["window.limit_close"], False),
    )
    for index, (name, source_id, source, target_id, target, exterior) in enumerate(control_routes):
        _draw_device_route(
            parent, name, source, target, layout, config, window_center,
            positions=positions, color=CONTROL,
            source_id=source_id, target_id=target_id,
            wire_type="actuator_control", lane=_lane(index, len(control_routes)), exterior=exterior,
        )

    legend_y = -config.room_depth_m * 0.37
    for index, (label, color) in enumerate((
        ("+12 / +5 V", POWER),
        ("GND", GROUND),
        ("I2C / UART", SENSOR_BUS),
        ("MOTOR / FAN CONTROL", CONTROL),
    )):
        x = -0.58 + index * 0.40
        add_cable(parent, f"wire-legend-line-{index + 1}", ((x, legend_y, 0.15), (x + 0.24, legend_y, 0.15)), color, thickness=4)
        add_label(parent, label, (x + 0.33, legend_y, 0.22), 0.047)


def _build_wall_raceways(
    parent: Any,
    config: SceneConfig,
    layout: EquipmentLayout,
    positions: dict[str, tuple[float, float, float]],
) -> None:
    width, depth, wall_t = config.room_width_m, config.room_depth_m, config.wall_thickness_m
    rear_width = width - wall_t * 2
    make_box(
        parent,
        "raceway.rear-horizontal",
        (0, layout.rear_channel_y, layout.trunk_z),
        (rear_width, RACEWAY_DEPTH_M, RACEWAY_HEIGHT_M),
        RACEWAY,
        specular=(0.46, 0.50, 0.50),
        shininess=36,
    )

    cabinet_top = layout.control_cabinet_center[2] + CONTROL_CABINET_HEIGHT_M / 2
    _add_vertical_raceway(
        parent,
        "raceway.controller-drop",
        layout.controller_drop_x,
        layout.rear_channel_y,
        cabinet_top,
        layout.trunk_z,
    )

    indoor_top = layout.indoor_sensor_center[2] + INDOOR_MOUNT_PANEL_HEIGHT_M / 2
    _add_vertical_raceway(
        parent,
        "raceway.indoor-sensor-drop",
        layout.indoor_drop_x,
        layout.rear_channel_y,
        indoor_top,
        layout.trunk_z,
    )

    for object_id in ("fan.intake", "fan.exhaust"):
        fan = positions[object_id]
        _add_vertical_raceway(
            parent,
            f"raceway.{object_id.replace('.', '-')}-drop",
            fan[0],
            layout.rear_channel_y,
            fan[2] + 0.40,
            layout.trunk_z,
        )

    exterior_wall_y = depth / 2 + wall_t
    make_cylinder(
        parent,
        "raceway.outdoor-wall-penetration",
        (layout.exterior_entry_x, depth / 2 + wall_t / 2, layout.trunk_z),
        0.052,
        wall_t + 0.09,
        RACEWAY,
        axis="y",
        segments=14,
    )
    horizontal_length = abs(layout.outdoor_gland_x - layout.exterior_entry_x) + RACEWAY_DEPTH_M
    make_box(
        parent,
        "raceway.outdoor-horizontal",
        ((layout.outdoor_gland_x + layout.exterior_entry_x) / 2, layout.exterior_channel_y, layout.trunk_z),
        (horizontal_length, RACEWAY_DEPTH_M, RACEWAY_HEIGHT_M),
        RACEWAY,
        specular=(0.46, 0.50, 0.50),
        shininess=36,
    )
    outdoor_drop_height = layout.trunk_z - layout.outdoor_gland_z
    make_box(
        parent,
        "raceway.outdoor-sensor-drop",
        (layout.outdoor_gland_x, layout.exterior_channel_y, (layout.trunk_z + layout.outdoor_gland_z) / 2),
        (RACEWAY_DEPTH_M, RACEWAY_DEPTH_M, outdoor_drop_height),
        RACEWAY,
        specular=(0.46, 0.50, 0.50),
        shininess=36,
    )
    add_label(
        parent,
        "WALL-MOUNTED LOW-VOLTAGE RACEWAY",
        (0, layout.rear_wire_y, layout.trunk_z + RACEWAY_HEIGHT_M),
        0.058,
    )


def _add_vertical_raceway(
    parent: Any,
    name: str,
    x: float,
    y: float,
    bottom_z: float,
    top_z: float,
) -> None:
    height = max(top_z - bottom_z, RACEWAY_HEIGHT_M)
    make_box(
        parent,
        name,
        (x, y, (top_z + bottom_z) / 2),
        (RACEWAY_DEPTH_M, RACEWAY_DEPTH_M, height),
        RACEWAY,
        specular=(0.46, 0.50, 0.50),
        shininess=36,
    )


def _draw_device_route(
    parent: Any,
    name: str,
    source: tuple[float, float, float],
    target: tuple[float, float, float],
    layout: EquipmentLayout,
    config: SceneConfig,
    window_center: tuple[float, float, float],
    *,
    positions: dict[str, tuple[float, float, float]],
    color: tuple[float, float, float, float],
    source_id: str,
    target_id: str,
    wire_type: str,
    lane: float,
    exterior: bool,
) -> None:
    if source_id in CONTROL_PANEL_COMPONENTS and target_id in CONTROL_PANEL_COMPONENTS:
        points = (source, target)
    elif exterior:
        points = _outdoor_route(source, target, positions["wire.outdoor_gland"], layout, lane)
    elif (
        target_id == "sensor.group.indoor"
        or target_id.startswith("sensor.scd41.indoor")
        or target_id.startswith("sensor.sps30.indoor")
    ):
        points = _indoor_sensor_route(source, target, positions["wire.indoor_gland"], layout, lane)
    elif target_id == "window.actuator":
        points = _window_actuator_route(source, target, layout, config, window_center, lane)
    elif target_id in {"window.reed_switch", "window.limit_open", "window.limit_close"}:
        points = _window_switch_route(source, target, layout, config, lane)
    else:
        points = _inside_route(source, target, layout, lane)
    path = _draw_wire(
        parent,
        name,
        points,
        color,
        source_id=source_id,
        target_id=target_id,
        wire_type=wire_type,
        thickness=3.0 if wire_type in {"power", "ground"} else 2.8,
    )
    path.setTag("aircheck.routed_via_wall_trunk", "true")


def _inside_route(
    source: tuple[float, float, float],
    target: tuple[float, float, float],
    layout: EquipmentLayout,
    lane: float,
) -> tuple[tuple[float, float, float], ...]:
    wire_y = layout.rear_wire_y + lane * 0.18
    trunk_z = layout.trunk_z + lane
    points = _controller_trunk_route(source, layout, lane)
    points.extend(
        (
            (target[0], wire_y, trunk_z),
            (target[0], wire_y, target[2]),
            target,
        )
    )
    return _remove_adjacent_duplicates(points)


def _outdoor_route(
    source: tuple[float, float, float],
    target: tuple[float, float, float],
    gland: tuple[float, float, float],
    layout: EquipmentLayout,
    lane: float,
) -> tuple[tuple[float, float, float], ...]:
    inside_y = layout.rear_wire_y + lane * 0.18
    outside_y = layout.exterior_wire_y + lane * 0.18
    trunk_z = layout.trunk_z + lane
    points = _controller_trunk_route(source, layout, lane)
    points.extend(
        (
            (layout.exterior_entry_x, inside_y, trunk_z),
            (layout.exterior_entry_x, outside_y, trunk_z),
            (gland[0], outside_y, trunk_z),
            (gland[0], outside_y, gland[2]),
            (gland[0], gland[1], gland[2]),
            (gland[0], gland[1], target[2]),
            (target[0], gland[1], target[2]),
            target,
        )
    )
    return _remove_adjacent_duplicates(points)


def _indoor_sensor_route(
    source: tuple[float, float, float],
    target: tuple[float, float, float],
    gland: tuple[float, float, float],
    layout: EquipmentLayout,
    lane: float,
) -> tuple[tuple[float, float, float], ...]:
    wire_y = layout.rear_wire_y + lane * 0.18
    trunk_z = layout.trunk_z + lane
    points = _controller_trunk_route(source, layout, lane)
    points.extend(
        (
            (layout.indoor_drop_x, wire_y, trunk_z),
            (layout.indoor_drop_x, wire_y, gland[2]),
            (gland[0], wire_y, gland[2]),
            gland,
            (gland[0], gland[1], target[2]),
            (target[0], gland[1], target[2]),
            target,
        )
    )
    return _remove_adjacent_duplicates(points)


def _window_actuator_route(
    source: tuple[float, float, float],
    target: tuple[float, float, float],
    layout: EquipmentLayout,
    config: SceneConfig,
    window_center: tuple[float, float, float],
    lane: float,
) -> tuple[tuple[float, float, float], ...]:
    wire_y = layout.rear_wire_y + lane * 0.18
    trunk_z = layout.trunk_z + lane
    frame = min(config.wall_thickness_m * 0.42, 0.065)
    left_jamb_x = -(config.window_width_m / 2 + frame / 2)
    sill_z = window_center[2] - config.window_height_m / 2
    service_z = sill_z - RACEWAY_HEIGHT_M / 2
    points = _controller_trunk_route(source, layout, lane)
    points.extend(
        (
            (left_jamb_x, wire_y, trunk_z),
            (left_jamb_x, wire_y, service_z),
            (target[0], wire_y, service_z),
            (target[0], wire_y, target[2]),
            target,
        )
    )
    return _remove_adjacent_duplicates(points)


def _window_switch_route(
    source: tuple[float, float, float],
    target: tuple[float, float, float],
    layout: EquipmentLayout,
    config: SceneConfig,
    lane: float,
) -> tuple[tuple[float, float, float], ...]:
    wire_y = layout.rear_wire_y + lane * 0.18
    trunk_z = layout.trunk_z + lane
    frame = min(config.wall_thickness_m * 0.42, 0.065)
    side = -1 if target[0] < 0 else 1
    jamb_x = side * (config.window_width_m / 2 + frame / 2)
    points = _controller_trunk_route(source, layout, lane)
    points.extend(
        (
            (jamb_x, wire_y, trunk_z),
            (jamb_x, wire_y, target[2]),
            (target[0], wire_y, target[2]),
            target,
        )
    )
    return _remove_adjacent_duplicates(points)


def _controller_trunk_route(
    source: tuple[float, float, float],
    layout: EquipmentLayout,
    lane: float,
) -> list[tuple[float, float, float]]:
    wire_y = layout.rear_wire_y + lane * 0.18
    trunk_z = layout.trunk_z + lane
    return [
        source,
        (source[0], wire_y, source[2]),
        (layout.controller_drop_x, wire_y, source[2]),
        (layout.controller_drop_x, wire_y, trunk_z),
    ]


def _draw_wire(
    parent: Any,
    name: str,
    points: tuple[tuple[float, float, float], ...] | list[tuple[float, float, float]],
    color: tuple[float, float, float, float],
    *,
    source_id: str,
    target_id: str,
    wire_type: str,
    thickness: float,
) -> Any:
    path = add_cable(parent, name, points, color, thickness=thickness)
    path.setTag("aircheck.wire_source", source_id)
    path.setTag("aircheck.wire_target", target_id)
    path.setTag("aircheck.wire_type", wire_type)
    path.setPythonTag("aircheck.route_points", tuple(points))
    return path


def _midpoint(
    first: tuple[float, float, float], second: tuple[float, float, float]
) -> tuple[float, float, float]:
    return tuple((first[index] + second[index]) / 2 for index in range(3))


def _lane(index: int, count: int) -> float:
    return (index - (count - 1) / 2) * 0.012


def _remove_adjacent_duplicates(
    points: list[tuple[float, float, float]],
) -> tuple[tuple[float, float, float], ...]:
    result: list[tuple[float, float, float]] = []
    for point in points:
        if not result or not math.isclose(sum((point[i] - result[-1][i]) ** 2 for i in range(3)), 0.0, abs_tol=1e-10):
            result.append(point)
    return tuple(result)
