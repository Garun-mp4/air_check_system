from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aircheck_simulator_3d.app.config import SceneConfig
from aircheck_simulator_3d.scene.device_models.geometry import create_pickable_part, make_cylinder
from aircheck_simulator_3d.scene.device_models.layout import (
    CONTROL_CABINET_HEIGHT_M,
    CONTROL_CABINET_WIDTH_M,
    ESP32_CABLE_EXIT_Z_M,
    ESP32_PANEL_X_M,
    EquipmentLayout,
    world_position,
)
from aircheck_simulator_3d.scene.objects import SceneObject, add_world_label, make_box


@dataclass
class ElectronicsAssembly:
    objects: dict[str, SceneObject]
    positions: dict[str, tuple[float, float, float]]


def build_electronics_block(parent: Any, config: SceneConfig) -> ElectronicsAssembly:
    from panda3d.core import PandaNode

    layout = EquipmentLayout.from_config(config)
    center = layout.control_cabinet_center
    cabinet = parent.attachNewNode(PandaNode("technical-electronics-cabinet"))
    cabinet.setPos(*center)
    width, height = CONTROL_CABINET_WIDTH_M, CONTROL_CABINET_HEIGHT_M
    make_box(cabinet, "electronics-backplate", (0, 0.02, 0), (width, 0.12, height), (0.48, 0.52, 0.49, 1), specular=(0.32, 0.35, 0.32), shininess=28)
    rail_color = (0.19, 0.24, 0.26, 1)
    for index, (position, size) in enumerate((
        ((-width / 2, -0.06, 0), (0.09, 0.24, height)),
        ((width / 2, -0.06, 0), (0.09, 0.24, height)),
        ((0, -0.06, -height / 2), (width, 0.24, 0.09)),
        ((0, -0.06, height / 2), (width, 0.24, 0.09)),
    )):
        make_box(cabinet, f"electronics-cabinet-rail-{index + 1}", position, size, rail_color, specular=(0.43, 0.47, 0.47), shininess=50)
    for x in (-0.62, 0.62):
        for z in (-0.75, 0.75):
            make_cylinder(cabinet, f"cabinet-mount-{x}-{z}", (x, -0.05, z), 0.027, 0.035, (0.75, 0.77, 0.72, 1), axis="y", segments=12)
    make_box(cabinet, "electronics-din-rail-top", (0, -0.08, 0.37), (1.30, 0.08, 0.035), (0.65, 0.69, 0.66, 1))
    make_box(cabinet, "electronics-din-rail-bottom", (0, -0.08, -0.44), (1.30, 0.08, 0.035), (0.65, 0.69, 0.66, 1))
    add_world_label(cabinet, "CONTROL  /  12 V POWER", (-0.36, -0.18, 0.86), 0.068)

    objects: dict[str, SceneObject] = {}
    positions: dict[str, tuple[float, float, float]] = {}

    wire_exit = cabinet.attachNewNode(PandaNode("cabinet-wire-exit"))
    wire_exit.setPos(ESP32_PANEL_X_M, -0.17, ESP32_CABLE_EXIT_Z_M)
    make_cylinder(wire_exit, "cabinet-wire-gland", (0, 0, 0), 0.045, 0.10, (0.17, 0.22, 0.23, 1), axis="z", segments=12)
    positions["wire.esp32_exit"] = world_position(wire_exit, parent)

    def part(
        object_id: str,
        title: str,
        description: str,
        local_position: tuple[float, float, float],
        half_extents: tuple[float, float, float],
    ) -> Any:
        obj, visual = create_pickable_part(
            cabinet,
            object_id=object_id,
            title=title,
            description=description,
            position=local_position,
            half_extents=half_extents,
        )
        objects[object_id] = obj
        positions[object_id] = world_position(obj.node, parent)
        return visual

    esp = part(
        "device.esp32",
        "ESP32-DevKitC V4 · ESP32-WROOM-32E",
        "Контроллер AirCheck. На нём сходятся цифровые линии датчиков, управление вентиляторами и сигналы H-моста оконного привода.",
        (ESP32_PANEL_X_M, -0.17, 0.59),
        (0.24, 0.07, 0.13),
    )
    make_box(esp, "esp32-pcb", (0, 0, 0), (0.45, 0.045, 0.24), (0.05, 0.39, 0.28, 1), specular=(0.34, 0.48, 0.37), shininess=46)
    make_box(esp, "esp32-wroom-shield", (0.045, -0.031, 0.015), (0.22, 0.035, 0.14), (0.68, 0.72, 0.68, 1), specular=(0.78, 0.8, 0.77), shininess=78)
    make_box(esp, "esp32-antenna", (0.155, -0.052, 0.015), (0.025, 0.012, 0.105), (0.82, 0.83, 0.75, 1))
    make_box(esp, "esp32-chip", (-0.11, -0.041, -0.015), (0.09, 0.025, 0.08), (0.12, 0.15, 0.17, 1))
    make_box(esp, "esp32-usb-shell", (-0.245, -0.005, 0), (0.08, 0.09, 0.10), (0.66, 0.68, 0.65, 1), specular=(0.8, 0.82, 0.8), shininess=82)
    for side in (-1, 1):
        for index in range(8):
            x = -0.19 + index * 0.055
            make_box(esp, f"esp32-header-{side}-{index + 1}", (x, side * 0.034, -0.115), (0.024, 0.025, 0.055), (0.13, 0.15, 0.16, 1))

    psu = part(
        "power.psu_12v",
        "Блок питания 230 VAC → 12 V DC",
        "Изолированный источник питания 12 V для вентиляторов и оконного привода. Сетевой ввод показан как модель подключения; силовая электроника не является действующей.",
        (-0.40, -0.16, 0.02),
        (0.26, 0.11, 0.17),
    )
    make_box(psu, "psu-metal-case", (0, 0, 0), (0.50, 0.22, 0.32), (0.69, 0.72, 0.68, 1), specular=(0.65, 0.67, 0.63), shininess=62)
    make_box(psu, "psu-end-panel", (-0.20, -0.12, 0), (0.08, 0.025, 0.22), (0.27, 0.31, 0.3, 1))
    for index in range(7):
        z = -0.12 + index * 0.04
        make_box(psu, f"psu-vent-{index + 1}", (0, -0.12, z), (0.32, 0.014, 0.018), (0.28, 0.32, 0.31, 1))
    make_box(psu, "psu-ac-terminal", (0.22, -0.12, 0.09), (0.07, 0.045, 0.07), (0.69, 0.42, 0.18, 1))
    make_box(psu, "psu-dc-terminal", (0.22, -0.12, -0.09), (0.07, 0.045, 0.07), (0.13, 0.3, 0.23, 1))
    add_world_label(psu, "230 VAC  >  12 V", (0, -0.14, 0.22), 0.065)

    dc = part(
        "power.dc_dc",
        "Преобразователь DC/DC 12 V → 5 V",
        "Понижающий преобразователь 12 V → 5 V питает ESP32 и низковольтные датчики.",
        (0.37, -0.14, 0.59),
        (0.21, 0.07, 0.12),
    )
    make_box(dc, "dc-converter-pcb", (0, 0, 0), (0.40, 0.045, 0.22), (0.06, 0.38, 0.27, 1), specular=(0.34, 0.48, 0.37), shininess=46)
    make_box(dc, "dc-converter-inductor", (-0.06, -0.036, 0.005), (0.09, 0.035, 0.085), (0.2, 0.22, 0.2, 1))
    for index, x in enumerate((-0.13, 0.12)):
        make_cylinder(dc, f"dc-converter-capacitor-{index + 1}", (x, -0.04, -0.045), 0.027, 0.065, (0.76, 0.71, 0.43, 1), axis="y", segments=12)
    make_box(dc, "dc-converter-input-terminal", (-0.18, -0.045, 0.085), (0.07, 0.035, 0.045), (0.82, 0.48, 0.18, 1))
    make_box(dc, "dc-converter-output-terminal", (0.18, -0.045, 0.085), (0.07, 0.035, 0.045), (0.12, 0.34, 0.27, 1))

    mosfet = part(
        "power.mosfet_module",
        "Двухканальный MOSFET-модуль",
        "Два низковольтных канала коммутации питания вентиляторов. Визуальные индикаторы вентиляторов связаны с их виртуальными состояниями.",
        (0.37, -0.14, 0.10),
        (0.21, 0.07, 0.12),
    )
    make_box(mosfet, "mosfet-board", (0, 0, 0), (0.40, 0.045, 0.22), (0.08, 0.34, 0.27, 1), specular=(0.34, 0.46, 0.36), shininess=42)
    for index, x in enumerate((-0.11, 0.11)):
        make_box(mosfet, f"mosfet-switch-{index + 1}", (x, -0.04, 0.015), (0.09, 0.035, 0.105), (0.12, 0.15, 0.16, 1))
        make_box(mosfet, f"mosfet-output-terminal-{index + 1}", (x, -0.038, 0.115), (0.13, 0.035, 0.05), (0.19, 0.27, 0.28, 1))

    hbridge = part(
        "power.h_bridge",
        "H-мост оконного привода",
        "Реверсивный драйвер двигателя меняет полярность 12 V для открытия и закрытия створки. Фактические концевики и остановка задаются Window Actuator в Device Layer.",
        (0.37, -0.14, -0.39),
        (0.21, 0.08, 0.13),
    )
    make_box(hbridge, "hbridge-board", (0, 0, 0), (0.41, 0.05, 0.23), (0.19, 0.33, 0.29, 1), specular=(0.35, 0.44, 0.4), shininess=40)
    make_box(hbridge, "hbridge-driver-chip", (0, -0.034, 0), (0.14, 0.035, 0.11), (0.14, 0.16, 0.17, 1))
    for index in range(5):
        x = -0.13 + index * 0.065
        make_box(hbridge, f"hbridge-heatsink-fin-{index + 1}", (x, -0.075, 0.01), (0.025, 0.07, 0.13), (0.6, 0.65, 0.62, 1), specular=(0.69, 0.72, 0.68), shininess=58)
    for index, x in enumerate((-0.17, 0.17)):
        make_box(hbridge, f"hbridge-terminal-{index + 1}", (x, -0.04, -0.12), (0.09, 0.045, 0.05), (0.83, 0.5, 0.17, 1))

    fuses = part(
        "power.fuses",
        "Предохранители 12 V",
        "Плавкие вставки защищают отдельно ветви вентиляторов и оконного привода от сверхтока.",
        (-0.39, -0.14, -0.35),
        (0.23, 0.075, 0.09),
    )
    for index, z in enumerate((-0.045, 0.045)):
        make_cylinder(fuses, f"fuse-glass-{index + 1}", (0, -0.01, z), 0.026, 0.32, (0.71, 0.79, 0.72, 0.72), axis="x", segments=12)
        for x in (-0.17, 0.17):
            make_box(fuses, f"fuse-clip-{index}-{x}", (x, -0.02, z), (0.055, 0.065, 0.07), (0.68, 0.71, 0.63, 1))

    terminals = part(
        "power.terminal_blocks",
        "Клеммники и распределительные шины",
        "Клеммный ряд распределяет +12 V, GND, 5 V, линии датчиков и управляющие сигналы по узлам стенда.",
        (0.03, -0.14, -0.71),
        (0.51, 0.075, 0.065),
    )
    for index in range(8):
        x = -0.49 + index * 0.14
        block_color = (0.79, 0.42, 0.14, 1) if index < 3 else ((0.18, 0.48, 0.35, 1) if index < 6 else (0.25, 0.37, 0.62, 1))
        make_box(terminals, f"terminal-{index + 1}", (x, 0, 0), (0.12, 0.12, 0.13), block_color)
        make_cylinder(terminals, f"terminal-screw-{index + 1}", (x, -0.069, 0.018), 0.027, 0.022, (0.76, 0.78, 0.72, 1), axis="y", segments=10)

    return ElectronicsAssembly(objects=objects, positions=positions)
