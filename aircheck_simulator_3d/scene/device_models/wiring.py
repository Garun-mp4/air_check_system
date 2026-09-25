from __future__ import annotations

from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig
from aircheck_simulator_3d.scene.device_models.geometry import add_cable, add_label


POWER = (0.88, 0.20, 0.16, 1)
GROUND = (0.18, 0.23, 0.25, 1)
SENSOR_BUS = (0.06, 0.55, 0.78, 1)
CONTROL = (0.9, 0.59, 0.13, 1)


def build_wire_routes(
    parent: Any,
    config: SceneConfig,
    *,
    positions: dict[str, tuple[float, float, float]],
    window_center: tuple[float, float, float],
) -> None:
    """Lay out readable low-voltage cable bundles; colors encode their purpose."""
    width, depth, height = config.room_width_m, config.room_depth_m, config.room_height_m
    psu = positions["power.psu_12v"]
    dc = positions["power.dc_dc"]
    esp = positions["device.esp32"]
    mosfet = positions["power.mosfet_module"]
    hbridge = positions["power.h_bridge"]
    terminal = positions["power.terminal_blocks"]
    intake = positions["fan.intake"]
    exhaust = positions["fan.exhaust"]
    indoor_co2 = positions["sensor.scd41.indoor"]
    indoor_pm = positions["sensor.sps30.indoor"]
    outdoor_temp = positions["sensor.sht45.outdoor"]
    outdoor_pm = positions["sensor.sps30.outdoor"]

    # Color-coded lines follow the rear wall and side cable trays so they read as bundles.
    tray_y = depth * 0.30
    tray_z = height * 0.83
    power_routes = (
        ("power-12v-intake", psu, intake, -0.20),
        ("power-12v-exhaust", psu, exhaust, -0.16),
        ("power-12v-window-actuator", hbridge, window_center, -0.12),
        ("power-12v-dc-dc", psu, dc, -0.08),
    )
    for name, source, target, y_offset in power_routes:
        add_cable(
            parent,
            name,
            (
                (source[0], source[1] - 0.15, source[2]),
                (source[0], tray_y + y_offset, tray_z),
                (target[0], tray_y + y_offset, tray_z),
                (target[0], target[1] - 0.12, target[2]),
            ),
            POWER,
            thickness=3.4,
        )

    ground_routes = (
        ("ground-intake", terminal, intake, -0.24),
        ("ground-exhaust", terminal, exhaust, -0.20),
        ("ground-window", terminal, window_center, -0.16),
        ("ground-controller", terminal, esp, -0.12),
    )
    for name, source, target, y_offset in ground_routes:
        add_cable(
            parent,
            name,
            (
                (source[0], source[1] - 0.18, source[2]),
                (source[0], tray_y + y_offset, tray_z - 0.10),
                (target[0], tray_y + y_offset, tray_z - 0.10),
                (target[0], target[1] - 0.13, target[2]),
            ),
            GROUND,
            thickness=2.6,
        )

    sensor_routes = (
        ("i2c-indoor-climate", esp, indoor_co2, -0.32),
        ("uart-indoor-particles", esp, indoor_pm, -0.28),
        ("i2c-outdoor-climate", esp, outdoor_temp, -0.24),
        ("uart-outdoor-particles", esp, outdoor_pm, -0.20),
    )
    for name, source, target, y_offset in sensor_routes:
        add_cable(
            parent,
            name,
            (
                (source[0], source[1] - 0.11, source[2]),
                (source[0], tray_y + y_offset, tray_z + 0.04),
                (target[0], tray_y + y_offset, tray_z + 0.04),
                (target[0], target[1] - 0.13, target[2]),
            ),
            SENSOR_BUS,
            thickness=2.8,
        )

    control_routes = (
        ("control-esp32-mosfet", esp, mosfet, 0.04),
        ("control-esp32-hbridge", esp, hbridge, 0.08),
        ("control-esp32-intake", mosfet, intake, 0.12),
        ("control-esp32-exhaust", mosfet, exhaust, 0.16),
    )
    for name, source, target, y_offset in control_routes:
        add_cable(
            parent,
            name,
            (
                (source[0], source[1] - 0.12, source[2]),
                (source[0], tray_y + y_offset, tray_z + 0.12),
                (target[0], tray_y + y_offset, tray_z + 0.12),
                (target[0], target[1] - 0.12, target[2]),
            ),
            CONTROL,
            thickness=2.8,
        )

    # Small legend tags tie the wiring colors to their intended function.
    legend_y = -depth * 0.37
    for index, (label, color) in enumerate((
        ("+12 / +5 V", POWER),
        ("GND", GROUND),
        ("I2C / UART", SENSOR_BUS),
        ("MOTOR / FAN CONTROL", CONTROL),
    )):
        add_cable(parent, f"wire-legend-line-{index + 1}", ((-0.58 + index * 0.40, legend_y, 0.15), (-0.34 + index * 0.40, legend_y, 0.15)), color, thickness=4)
        add_label(parent, label, (-0.25 + index * 0.40, legend_y, 0.22), 0.047)
