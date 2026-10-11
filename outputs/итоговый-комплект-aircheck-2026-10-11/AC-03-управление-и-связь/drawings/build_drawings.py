"""Generate the five AC-03 A3 drawing sheets and their editable DXF.

One geometry list feeds both the PDF sheets and the tiled model-space DXF so
dimensions, labels and positions cannot silently diverge between releases.
All coordinates and dimensions are millimetres.
"""
from __future__ import annotations

import json
import math
import argparse
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
DRAW = ROOT / "drawings"
RELEASE = "R02"
SHEETS = 5
PAGE_W, PAGE_H = 420.0, 297.0
DXF_GAP = 24.0
STANDARD_TEXT_HEIGHTS = (2.5, 3.5, 5.0, 7.0, 10.0, 14.0, 20.0, 28.0, 40.0)
FONT = "AC03GOST"
pdfmetrics.registerFont(TTFont(FONT, r"C:\Windows\Fonts\GOST_BU.ttf"))
FONT_FACE = pdfmetrics.getFont(FONT).face
E: list[dict] = []
SHEET = 1


def width_mm(value: str, height_mm: float) -> float:
    height_mm = standard_text_height(height_mm)
    size_pt = height_mm * 72.0 / 25.4 * 1000.0 / FONT_FACE.capHeight
    return pdfmetrics.stringWidth(value, FONT, size_pt) * 25.4 / 72.0


def standard_text_height(height_mm: float) -> float:
    """Snap requested lettering heights to the ГОСТ 2.304-81 size series."""
    return min(STANDARD_TEXT_HEIGHTS, key=lambda item: (abs(item - height_mm), item))


def line(x1, y1, x2, y2, layer="OUT"):
    E.append({"type": "Line", "sheet": SHEET, "layer": layer,
              "start": [round(x1, 4), round(y1, 4)],
              "end": [round(x2, 4), round(y2, 4)]})


def rect(x, y, w, h, layer="OUT"):
    line(x, y, x + w, y, layer)
    line(x + w, y, x + w, y + h, layer)
    line(x + w, y + h, x, y + h, layer)
    line(x, y + h, x, y, layer)


def circle(x, y, r, layer="OUT"):
    E.append({"type": "Circle", "sheet": SHEET, "layer": layer,
              "center": [round(x, 4), round(y, 4)], "radius": r})


def text(x, y, value, height=3.2, align="left", rotation=0, layer="TEXT",
         cell_bounds=None):
    item = {"type": "Text", "sheet": SHEET, "layer": layer,
            "x": round(x, 4), "y": round(y, 4),
            "height": standard_text_height(height),
            "align": align, "rotation": rotation, "value": value}
    if cell_bounds is not None:
        item["cell_bounds"] = [round(v, 4) for v in cell_bounds]
    E.append(item)


def centered(x, y, value, height=3.2, layer="TEXT", cell_bounds=None):
    text(x, y, value, height, "center", 0, layer, cell_bounds)


def box_label(x, y, w, h, value, size=3.0):
    rect(x, y, w, h, "OUT")
    lines = value.split("\n")
    step = size * 1.45
    baseline = y + (h + (len(lines) - 1) * step) / 2 - size * 0.38
    for i, row in enumerate(lines):
        centered(x + w / 2, baseline - i * step, row, size)


def arrow(x1, y1, x2, y2, head=2.0, layer="THIN"):
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy)
    if n < 1e-8:
        return
    ux, uy = dx / n, dy / n
    px, py = -uy * head * 0.55, ux * head * 0.55
    bx, by = x2 - ux * head, y2 - uy * head
    line(x1, y1, x2, y2, layer)
    line(x2, y2, bx + px, by + py, layer)
    line(x2, y2, bx - px, by - py, layer)


def vertical_cut_trace(x, y0, y1, letter):
    """Mark a section plane running vertically through a plan view."""
    line(x, y0, x, y1, "CUT")
    for y in (y0, y1):
        arrow(x - 5, y, x + 1, y, head=2.0, layer="CUT")
        text(x + 4, y - 1, letter, 2.5, layer="TEXT")


def horizontal_cut_trace(x0, x1, y, letter):
    """Mark a section plane running horizontally through a plan view."""
    line(x0, y, x1, y, "CUT")
    for x in (x0, x1):
        arrow(x, y + 4, x, y - 2, head=2.0, layer="CUT")
        text(x - 1, y - 5, letter, 2.5, layer="TEXT")


def u_section(x, y, width, height, wall, floor):
    """Draw a hatched U-shaped section of the open enclosure base."""
    points = [
        (x, y), (x + width, y), (x + width, y + height),
        (x + width - wall, y + height),
        (x + width - wall, y + floor),
        (x + wall, y + floor), (x + wall, y + height),
        (x, y + height), (x, y),
    ]
    for a, b in zip(points, points[1:]):
        line(a[0], a[1], b[0], b[1], "OUT")
    hatch_box(x, y, width, floor, 4.0)
    hatch_box(x, y + floor, wall, height - floor, 4.0)
    hatch_box(x + width - wall, y + floor, wall, height - floor, 4.0)


def hat_section(x, y, width, height, side, top):
    """Draw a hatched section through the lid's top panel and side skirts."""
    points = [
        (x, y), (x + side, y), (x + side, y + height - top),
        (x + width - side, y + height - top),
        (x + width - side, y), (x + width, y),
        (x + width, y + height), (x, y + height), (x, y),
    ]
    for a, b in zip(points, points[1:]):
        line(a[0], a[1], b[0], b[1], "OUT")
    hatch_box(x, y, side, height - top, 3.0)
    hatch_box(x + side, y + height - top, width - 2 * side, top, 4.0)
    hatch_box(x + width - side, y, side, height - top, 3.0)


def dim_x(a, b, y, ext_y, label, size=3.2):
    line(a, ext_y, a, y - 1.0, "DIM")
    line(b, ext_y, b, y - 1.0, "DIM")
    line(a, y, b, y, "DIM")
    for x0, sign in ((a, 1), (b, -1)):
        line(x0, y, x0 + sign * 2.5, y + 0.9, "DIM")
        line(x0, y, x0 + sign * 2.5, y - 0.9, "DIM")
    tw = width_mm(label, size)
    centered((a + b) / 2, y + 1.4, label, size, "DIMTEXT")


def dim_y(a, b, x, ext_x, label, size=3.2):
    line(ext_x, a, x + 1.0, a, "DIM")
    line(ext_x, b, x + 1.0, b, "DIM")
    line(x, a, x, b, "DIM")
    for y0, sign in ((a, 1), (b, -1)):
        line(x, y0, x - 0.9, y0 + sign * 2.5, "DIM")
        line(x, y0, x + 0.9, y0 + sign * 2.5, "DIM")
    # A horizontal label beside the vertical dimension stays readable at print scale.
    text(x - width_mm(label, size) - 1.5, (a + b) / 2 - size * 0.35,
         label, size, layer="DIMTEXT")


def note_block(x, y, rows, size=3.0, step=6.4):
    for i, row in enumerate(rows):
        text(x, y - i * step, row, size)


def hatch_box(x, y, w, h, spacing=4.0):
    """45-degree hatch clipped to a rectangular cut surface."""
    t = -h
    while t <= w:
        points = []
        for px, py in ((0, -t), (w, w - t), (t, 0), (h + t, h)):
            if -1e-8 <= px <= w + 1e-8 and -1e-8 <= py <= h + 1e-8:
                pt = (round(x + min(w, max(0, px)), 5),
                      round(y + min(h, max(0, py)), 5))
                if pt not in points:
                    points.append(pt)
        if len(points) >= 2:
            a, b = max(((p1, p2) for i, p1 in enumerate(points)
                        for p2 in points[i + 1:]),
                       key=lambda pair: (pair[0][0] - pair[1][0]) ** 2
                                        + (pair[0][1] - pair[1][1]) ** 2)
            line(a[0], a[1], b[0], b[1], "THIN")
        t += spacing


def frame(number: int, title: str, designation: str, name: str, scale="1:1"):
    global SHEET
    SHEET = number
    rect(20, 5, 395, 287, "FRAME")
    text(26, 281, title, 4.6, layer="TITLE")
    text(26, 274, f"AirCheck | узел управления и связи | {RELEASE} | размеры в мм", 3.0)
    # Consistent compact title block. Table text anchors are centered by measured font width.
    rect(230, 5, 185, 55, "FRAME")
    for x in (250, 267, 282, 295, 365, 380, 395):
        line(x, 5, x, 60, "FRAME")
    for y in (10, 15, 20, 25, 30, 35, 40, 45, 50, 55):
        line(230, y, 295, y, "FRAME")
    line(295, 45, 415, 45, "FRAME")
    line(295, 30, 415, 30, "FRAME")
    line(365, 5, 365, 45, "FRAME")
    line(380, 30, 380, 45, "FRAME")
    line(395, 30, 395, 45, "FRAME")
    line(390, 20, 390, 30, "FRAME")
    for x, w, label in ((230, 20, "Изм."), (250, 17, "Лист"),
                        (267, 15, "Подп."), (282, 13, "Дата")):
        centered(x + w / 2, 51.25, label, 2.2,
                 cell_bounds=[x, 50, x + w, 55])
    text(298, 50.5, designation, 3.8, layer="TITLE",
         cell_bounds=[295, 45, 365, 60])
    text(298, 35.5, name, 3.0, cell_bounds=[295, 30, 365, 45])
    centered(372.5, 39.4, "Лит.", 2.1, cell_bounds=[365, 35, 380, 45])
    centered(387.5, 39.4, "Масса", 2.1, cell_bounds=[380, 35, 395, 45])
    centered(405, 39.4, "Масш.", 2.1, cell_bounds=[395, 35, 415, 45])
    centered(372.5, 32.0, "П", 2.4, cell_bounds=[365, 30, 380, 35])
    centered(405, 32.0, scale, 2.4, cell_bounds=[395, 30, 415, 35])
    text(298, 11.5, "Цифровой прототип; материал не задан", 2.4,
         cell_bounds=[295, 5, 365, 30])
    centered(377.5, 12.0, f"Лист {number} / {SHEETS}", 2.25,
             cell_bounds=[365, 5, 415, 30])
    for i, role in enumerate(("Разраб.", "Проверил", "Т. контр.", "Н. контр.", "Утв.")):
        row_top, row_bottom = 30 - i * 5, 25 - i * 5
        centered(240, 27.5 - i * 5, role, 2.1,
                 cell_bounds=[230, row_bottom, 250, row_top])
    # Keep footer notes in the left margin zone: the title block occupies x=230..415.
    # Two separated rows avoid collisions after normalizing all lettering to GOST sizes.
    text(26, 11, "Формат А3 (420 x 297 мм); печать 100%", 2.5)
    text(26, 7, "Контрольный отрезок 100 мм; подписи и нормоконтроль не выполнены", 2.5)


def sheet_1():
    frame(1, "Узел управления и связи. Общий вид", "AC-03-000 СБ",
          "Узел управления и связи", "1:1")
    text(42, 255, "Вид сверху, крышка снята; установочные размеры 1:1", 2.8)
    # Base and optional lid outline in top view, common X/Y datum.
    rect(42, 128, 140, 110, "OUT")
    rect(39, 125, 146, 116, "REF")
    rect(44.5, 130.5, 135, 105, "THIN")
    for x in (50, 174):
        for y in (136, 230):
            circle(x, y, 1.7, "OUT")
    # Simplified controller board and WROOM envelope, explicitly reference geometry.
    rect(98.03, 131.5, 27.94, 48.26, "REF")
    rect(103.0, 148.22, 18, 25.5, "REF")
    text(101, 183, "Плата ESP32 LOD0", 2.5)
    text(104, 145, "WROOM-32E", 2.4)
    # USB opening at the front and rear signal-wire opening.
    rect(103, 128, 18, 2.5, "THIN")
    rect(134, 235.5, 32, 2.5, "THIN")
    text(124, 123, "USB: 18 x 2,5 в плане", 2.45)
    text(126, 244, "Задний ввод: 32 x 2,5 в плане", 2.45)
    dim_x(39, 185, 250, 241, "146")
    dim_y(125, 241, 31, 39, "116")
    text(43, 112, "Контур основания 140 x 110; контур крышки выступает на 3 мм/сторону", 2.7)

    # Front elevation follows X/Z and exposes only the front USB service opening.
    x, y = 220, 153
    rect(x, y, 140, 55, "OUT")
    rect(x - 3, y + 50, 146, 8, "OUT")
    rect(x + 61, y + 5.6, 18, 10.4, "THIN")
    line(x + 70, y + 1, x + 70, y + 18, "CENTER")
    text(x, y + 66, "Вид спереди (USB), 1:1", 2.8)
    dim_x(x - 3, x + 143, y + 62, y + 58, "146")
    dim_y(y, y + 58, x - 9, x - 3, "58")
    note_block(220, 263, [
        "Состав цифровой сборки:",
        "1 — основание AC-03-001; 2 — крышка AC-03-002;",
        "3 — плата ESP32-DevKitC V4 (LOD0); 4 — опоры.",
        "REF — огибающие WROOM-32E и Micro-USB.",
        "Плата должна быть без нижних припаянных гребёнок.",
        "Электронные элементы показаны как REF, не для печати.",
    ], 2.4, 6.0)

    # Side elevation and exploded-order strip at lower-left.
    rect(220, 77, 110, 55, "OUT")
    rect(217, 127, 116, 8, "OUT")
    text(220, 139, "Вид сбоку, 1:1", 2.8)
    dim_x(217, 333, 72, 77, "116")
    dim_y(77, 135, 208, 217, "58")
    text(42, 91, "Условная схема разборки (не вид и не сборочный масштаб)", 2.7)
    rect(42, 53, 146, 7, "REF")
    text(195, 55, "Крышка", 2.7)
    rect(48, 66, 134, 2, "REF")
    text(195, 64.5, "Плата + съёмные опоры", 2.7)
    rect(45, 74, 140, 14, "OUT")
    text(195, 79, "Основание", 2.7)
    arrow(115, 61, 115, 65, 1.5)
    arrow(115, 69, 115, 73, 1.5)
    text(42, 43, "Крепёж крышки: 4 винта М3; длина подбирается после физической примерки.", 2.6)


def sheet_2():
    frame(2, "Основание корпуса. Чертёж детали", "AC-03-001",
          "Основание корпуса", "1:1")
    text(42, 260, "Вид сверху изнутри", 2.8)
    x, y = 42, 132
    rect(x, y, 140, 110, "OUT")
    rect(x + 2.5, y + 2.5, 135, 105, "THIN")
    for px in (8, 132):
        for py in (8, 102):
            rect(x + px - 7, y + py - 7, 14, 14, "THIN")
            circle(x + px, y + py, 1.25, "OUT")
            line(x + px - 3.2, y + py, x + px + 3.2, y + py, "CENTER")
            line(x + px, y + py - 3.2, x + px, y + py + 3.2, "CENTER")
    rect(x + 61, y, 18, 2.5, "THIN")
    rect(x + 92, y + 107.5, 32, 2.5, "THIN")
    dim_x(x, x + 140, y + 118, y + 110, "140")
    dim_y(y, y + 110, x - 10, x, "110")
    text(x + 60, y - 7, "Фасад USB 18 x 10,4; план 18 x 2,5; X=61…79; Z=5,6…16", 2.35)
    coordinate_datum = "Координаты X/Y/Z отсчитывать от наружного нижнего переднего левого угла основания."
    text(x, y - 12, coordinate_datum, 2.5)

    # Front view with USB cutout.
    fx, fy = 222, 170
    rect(fx, fy, 140, 55, "OUT")
    rect(fx + 61, fy + 5.6, 18, 10.4, "THIN")
    line(fx + 70, fy + 2, fx + 70, fy + 20, "CENTER")
    text(fx, fy + 62, "Вид спереди", 2.8)
    dim_x(fx, fx + 140, fy - 11, fy, "140")
    dim_y(fy, fy + 55, fx - 8, fx, "55")
    note_block(222, 260, [
        "USB окно 18 x 10,4 мм; X=61…79.",
        "По высоте Z=5,6…16 мм; сверить штекер.",
    ], 2.4, 6.0)

    # Rear wall opening and right side elevation.
    sx, sy = 222, 82
    rect(sx, sy, 110, 55, "OUT")
    text(sx, sy + 62, "Вид справа", 2.8)
    dim_x(sx, sx + 110, sy - 11, sy, "110")
    dim_y(sy, sy + 55, sx - 8, sx, "55")
    # Rear view looks toward -Y, so the horizontal X coordinate is mirrored.
    # Derive the opening position from the CAD source instead of duplicating it.
    rx, ry = 42, 55
    rear_scale = 0.5
    rect(rx, ry, 70, 27.5, "OUT")
    base = json.loads((ROOT / "cad" / "design.json").read_text(encoding="utf-8"))["parts"]["AC-03-001-base"]
    rear_opening = next(item for item in base["apertures"]
                        if item["name"] == "rear signal cable passage")
    rear_x, _, rear_z = rear_opening["p"]
    rear_w, _, rear_h = rear_opening["size"]
    base_width = base["outer"]["size"][0]
    rear_view_x = rx + (base_width - rear_x - rear_w) * rear_scale
    rect(rear_view_x, ry + rear_z * rear_scale,
         rear_w * rear_scale, rear_h * rear_scale, "THIN")
    text(rx, ry + 34, "Вид сзади, 1:2; окно 32 x 12", 2.5)
    dim_x(rx, rx + 70, ry - 7, ry, "140")
    dim_y(ry, ry + 27.5, rx - 9, rx, "55")

    note_block(122, 112, [
        "Четыре квадратные опоры",
        "14 x 14 мм; пилотное",
        "отверстие Ø2,5 мм.",
        "Центры отверстий:",
        "(8;8), (132;8),",
        "(8;102), (132;102).",
        "Отверстие — пилот под",
        "подбор винта/резьбы,",
        "не готовая резьба.",
    ], 2.45, 5.3)

    # Section plane at X=50 mm from the outside front-left datum; it avoids
    # the USB aperture, bosses and the reference PCB.
    vertical_cut_trace(x + 50, y - 4, y + 114, "А")

    # Full U-shaped section through the front-to-rear direction, at 1:2.
    sec_x, sec_y = 132, 20
    sec_w, sec_h = 55, 27.5
    u_section(sec_x, sec_y, sec_w, sec_h, 1.25, 1.5)
    text(sec_x, sec_y + sec_h + 5, "Сечение А-А, 1:2", 2.5)
    dim_x(sec_x, sec_x + sec_w, sec_y - 8, sec_y, "110", 2.5)
    dim_y(sec_y, sec_y + sec_h, sec_x - 8, sec_x, "55", 2.5)
    text(191, 41, "Стенка 2,5 мм", 2.5)
    arrow(190, 43, sec_x + sec_w - 0.6, 43, head=1.5)
    text(191, 25, "Дно 3 мм", 2.5)
    arrow(190, 26, sec_x + sec_w - 1.0, sec_y + 1.0, head=1.5)

    # The rear opening was visible in R01 but its location was not dimensioned.
    text(122, 64, "Проём задней стенки:", 2.5)
    text(122, 59, "X=92…124 мм; Z=7…19 мм.", 2.5)


def sheet_3():
    frame(3, "Крышка корпуса. Чертёж детали", "AC-03-002",
          "Крышка корпуса", "1:1")
    text(42, 260, "Вид снизу (посадочная полость)", 2.8)
    x, y = 42, 135
    rect(x, y, 146, 116, "OUT")
    rect(x + 2.6, y + 2.6, 140.8, 110.8, "THIN")
    # The lid outer contour is offset -3 mm from the enclosure datum in CAD.
    # Therefore body-hole coordinates (8/132, 8/102) sit 11 mm from the lid edges.
    for px in (11, 135):
        for py in (11, 105):
            circle(x + px, y + py, 1.7, "OUT")
            line(x + px - 3.0, y + py, x + px + 3.0, y + py, "CENTER")
            line(x + px, y + py - 3.0, x + px, y + py + 3.0, "CENTER")
    dim_x(x, x + 146, y + 124, y + 116, "146")
    dim_y(y, y + 116, x - 10, x, "116")
    text(45, y + 54, "Полость 140,8 x 110,8", 2.8)
    text(45, y + 48, "Зазор к основанию 0,4 мм/сторону", 2.55)
    text(45, y + 42, "Глубина полости 5,4 мм", 2.55)
    text(45, y + 34, "4 x Ø3,4; поля до наружных кромок 11 мм", 2.55)
    text(45, y + 28, "Шаг центров 124 x 94 мм", 2.45)
    text(45, y + 22, "В координатах корпуса: X=8/132; Y=8/102", 2.45)
    text(45, y + 16, "Начало координат — наружный нижний передний левый угол основания.", 2.5)

    # B-B passes through the lid center, clear of the four screw holes.
    horizontal_cut_trace(x - 4, x + 150, y + 58, "Б")

    # Full transverse section through the top panel and both side skirts.
    sx, sy = 245, 202
    hat_section(sx, sy, 146, 8, 2.6, 2.6)
    text(sx, sy + 15, "Сечение Б-Б, 1:1", 2.5)
    dim_x(sx, sx + 146, sy - 8, sy, "146", 2.5)
    dim_y(sy, sy + 8, sx + 156, sx + 146, "8", 2.5)
    dim_y(sy, sy + 5.4, sx - 9, sx, "5,4", 2.5)
    text(sx, sy - 17, "Панель крышки: 2,6 мм (8 - 5,4).", 2.5)
    note_block(245, 151, [
        "Заход стенок крышки на основание — 5,0 мм.",
        "Глубина полости крышки — 5,4 мм; запас",
        "над торцом основания — 0,4 мм.",
        "Боковой зазор — 0,4 мм на сторону.",
        "Измерить по пробной печати. При короблении",
        "или усадке не запрессовывать крышку винтами.",
    ], 2.55, 5.6)
    note_block(245, 108, [
        "Печатать наружной плоскостью к столу —",
        "только предварительный вариант. Ориентацию",
        "и поддержки подтвердить в выбранном слайсере.",
        "Материал и допуски печати не назначены.",
    ], 2.6, 6.2)
    text(42, 100, "Крепёж крышки — 4 винта М3 (внешние, в спецификации длина не назначена)", 2.6)
    text(42, 93, "Отверстия сквозные Ø3,4 мм; шайбы и длину винта подобрать после физической сборки.", 2.6)


def sheet_4():
    frame(4, "Функциональная схема: узлы AC-01, AC-02 и AC-03", "AC-03-004",
          "Функциональная схема", "Б/М")
    text(31, 260, "Каналы данных и интерфейсы AC-03. Не является принципиальной электрической схемой Э3.", 3.0)
    box_label(34, 190, 86, 46, "AC-01\nESP32 + SCD41\n+ SPS30", 3.1)
    box_label(34, 112, 86, 46, "AC-02\nESP32 + SHT45\n+ SPS30", 3.1)
    box_label(156, 168, 120, 68, "AC-03 / ESP32 DevKitC V4\nСбор A/B; control state;\nWi-Fi gateway\n(device_id = room-01)", 3.15)
    box_label(313, 180, 82, 44, "AirCheck API\n/measurements\n/controls/*", 3.1)
    arrow(120, 213, 156, 213, 2.4)
    text(121, 220, "ESP-NOW", 2.8)
    arrow(120, 135, 156, 183, 2.4)
    text(121, 165, "ESP-NOW", 2.8)
    arrow(276, 208, 313, 208, 2.4)
    arrow(313, 192, 276, 192, 2.4)
    text(285, 242, "Wi-Fi / HTTPS", 2.75)
    text(278, 174, "poll commands / POST state", 2.35)
    # Keep the GPIO and limit-switch relationships explicit: these are ESP32
    # interfaces inside AC-03, while power drivers and loads remain external.
    box_label(156, 120, 120, 33,
              "ESP32 DevKitC V4 / J2 / J3\nВыходы GPIO25/26/27/32 -> драйверы\nВходы pull-up GPIO33/18 <- NC концевики", 2.55)
    arrow(216, 168, 216, 153, 2.0)
    box_label(207, 70, 88, 31, "Внешние драйверы\nTBD / не входят в AC-03", 2.75)
    box_label(327, 70, 70, 31, "Вентиляторы /\nпривод окна\nне выбраны", 2.65)
    arrow(250, 120, 250, 101, 2.0)
    arrow(295, 85, 327, 85, 2.0)
    box_label(31, 23, 118, 22, "Внешние NC концевики\nОткрыто / закрыто", 2.55)
    line(149, 34, 150, 34, "THIN")
    line(150, 34, 150, 136, "THIN")
    arrow(150, 136, 156, 136, 2.0)
    text(31, 19, "Нагрузки подключать через драйверы; аппаратная подтяжка выключения при reset.", 2.35)


def sheet_5():
    frame(5, "Таблица соединений и состав интерфейсов", "AC-03-005",
          "Таблица сигналов и BOM", "Б/М")
    text(30, 260, "Контакты референсной Espressif DevKitC V4. Перед монтажом сверить исполнение платы и шелкографию.", 2.9)
    # Signal table: carefully fixed column widths and row baselines.
    x0, y_top = 30, 249
    cols = [30, 83, 154, 240, 292, 400]
    header_h, row_h = 11, 10.5
    rows = [
        ("Разъём", "GPIO", "Функция", "Тип / состояние", "Ограничение"),
        ("J2-9", "GPIO25", "Enable вытяжного вентилятора", "выход, HIGH = запрос", "Драйвер; аппаратная подтяжка вниз"),
        ("J2-10", "GPIO26", "Enable приточного вентилятора", "выход, HIGH = запрос", "Драйвер; аппаратная подтяжка вниз"),
        ("J2-11", "GPIO27", "Открыть окно", "выход, HIGH = запрос", "Драйвер; pull-down; блокировка с GPIO32"),
        ("J2-7", "GPIO32", "Закрыть окно", "выход, HIGH = запрос", "Драйвер; pull-down; блокировка с GPIO27"),
        ("J2-8", "GPIO33", "Концевик «открыто»", "вход pull-up; NC к GND", "HIGH: предел или обрыв"),
        ("J3-9", "GPIO18", "Концевик «закрыто»", "вход pull-up; NC к GND", "HIGH: предел или обрыв"),
        ("J2-14 / J3-1", "GND", "Общая логическая опора", "сигнальная цепь", "Только по схеме драйвера"),
    ]
    for i in range(len(rows)):
        yy = y_top - header_h - i * row_h
        line(x0, yy, 400, yy, "FRAME")
    line(x0, y_top, 400, y_top, "FRAME")
    for xx in cols:
        line(xx, y_top, xx, y_top - header_h - (len(rows) - 1) * row_h, "FRAME")
    for i, row in enumerate(rows):
        cy = y_top - header_h / 2 - i * row_h
        for j, value in enumerate(row):
            bottom = y_top - header_h - i * row_h
            cell_height = header_h if i == 0 else row_h
            centered((cols[j] + cols[j + 1]) / 2, cy - 0.8, value,
                     2.3 if i else 2.55,
                     cell_bounds=[cols[j], bottom, cols[j + 1], bottom + cell_height])

    text(30, 141, "Сокращённая ведомость состава", 3.3, layer="TITLE")
    bom_rows = [
        ("1", "AC-03-001 основание", "1", "FDM-кандидат; материал не подтверждён"),
        ("2", "AC-03-002 крышка", "1", "Печатать как отдельную деталь"),
        ("3", "ESP32-DevKitC-32E V4", "1", "Кандидат; без нижних гребёнок; не куплена"),
        ("4", "Кабель Micro-USB / источник 5 В", "1", "Модель и параметры не выбраны"),
        ("5", "Винт М3 / съёмные опоры", "4 / 2", "Длину/клей определить после примерки"),
        ("6", "Драйверы, нагрузки, концевики", "—", "TBD, в электрический выпуск не входят"),
    ]
    bcols = [30, 52, 203, 230, 400]
    top = 132
    header_height, bom_row_height = 9, 8.5
    header = ("Поз.", "Наименование", "Кол.", "Статус / примечание")
    for i in range(len(bom_rows) + 1):
        yy = top - header_height - i * bom_row_height
        line(30, yy, 400, yy, "FRAME")
    for xx in bcols:
        line(xx, top, xx, top - header_height - len(bom_rows) * bom_row_height, "FRAME")
    for i, row in enumerate([header, *bom_rows]):
        cy = top - header_height / 2 - i * bom_row_height
        for j, value in enumerate(row):
            bottom = top - header_height - i * bom_row_height
            cell_height = header_height if i == 0 else bom_row_height
            centered((bcols[j] + bcols[j + 1]) / 2, cy - 0.7, value,
                     2.15 if i else 2.35,
                     cell_bounds=[bcols[j], bottom, bcols[j + 1], bottom + cell_height])
    text(30, 65, "GPIO — только логика 3,3 В; токи, провода и защиты назначить после выбора драйверов и нагрузок.", 2.45)


def build_geometry() -> list[dict]:
    E.clear()
    sheet_1()
    sheet_2()
    sheet_3()
    sheet_4()
    sheet_5()
    return E


def render_pdf(entities: list[dict]) -> list[Path]:
    combined = DRAW / f"AC-03-drawings-{RELEASE}.pdf"
    pdf = canvas.Canvas(str(combined), pagesize=(PAGE_W * mm, PAGE_H * mm), pageCompression=1)
    pdf.setAuthor("AirCheck project")
    pdf.setTitle(f"AirCheck AC-03 — чертежи {RELEASE}")
    pdf.setSubject("Пять листов A3, цифровой прототип, мм")
    layer_width = {"OUT": 0.45, "FRAME": 0.25, "THIN": 0.22,
                   "DIM": 0.18, "DIMTEXT": 0.18, "CENTER": 0.18,
                   "REF": 0.22, "TEXT": 0.2, "TITLE": 0.3, "CUT": 0.35}
    layer_dash = {"REF": [2.0 * mm, 1.0 * mm], "CENTER": [7 * mm, 2 * mm, 1 * mm, 2 * mm]}
    layer_dash["CUT"] = [7 * mm, 2 * mm, 1 * mm, 2 * mm]
    for sheet_no in range(1, SHEETS + 1):
        for item in entities:
            if item["sheet"] != sheet_no:
                continue
            layer = item["layer"]
            pdf.setStrokeColor(colors.black)
            pdf.setFillColor(colors.black)
            pdf.setLineWidth(layer_width.get(layer, 0.22) * mm)
            pdf.setDash(layer_dash.get(layer, []))
            if item["type"] == "Line":
                a, b = item["start"], item["end"]
                pdf.line(a[0] * mm, a[1] * mm, b[0] * mm, b[1] * mm)
            elif item["type"] == "Circle":
                x, y = item["center"]
                pdf.circle(x * mm, y * mm, item["radius"] * mm, stroke=1, fill=0)
            elif item["type"] == "Text":
                size_pt = item["height"] * 72 / 25.4 * 1000 / FONT_FACE.capHeight
                pdf.saveState()
                x, y = item["x"] * mm, item["y"] * mm
                pdf.translate(x, y)
                if item["rotation"]:
                    pdf.rotate(item["rotation"])
                pdf.setFont(FONT, size_pt)
                value = item["value"]
                if item["align"] == "center":
                    pdf.drawCentredString(0, 0, value)
                else:
                    pdf.drawString(0, 0, value)
                pdf.restoreState()
        pdf.setDash()
        pdf.showPage()
    pdf.save()
    return [combined]


def render_dxf(entities: list[dict]) -> Path:
    layers = {
        "0": (7, 18, "CONTINUOUS"),
        "FRAME": (7, 18, "CONTINUOUS"),
        "OUT": (7, 35, "CONTINUOUS"),
        "THIN": (7, 18, "CONTINUOUS"),
        "DIM": (7, 13, "CONTINUOUS"),
        "DIMTEXT": (7, 13, "CONTINUOUS"),
        "CENTER": (7, 13, "CENTER"),
        "CUT": (7, 35, "CENTER"),
        "REF": (8, 18, "DASHED"),
        "TEXT": (7, 13, "CONTINUOUS"),
        "TITLE": (7, 25, "CONTINUOUS"),
    }
    def dxf_text(value: str) -> str:
        return value.replace("Ø", r"\U+00D8").replace("≥", r"\U+2265").replace("≤", r"\U+2264")

    lines = [
        "0", "SECTION", "2", "HEADER",
        "9", "$ACADVER", "1", "AC1027",
        "9", "$DWGCODEPAGE", "3", "ANSI_1251",
        "9", "$INSUNITS", "70", "4",
        "9", "$MEASUREMENT", "70", "1",
        "9", "$LUNITS", "70", "2",
        "9", "$LUPREC", "70", "2",
        "9", "$HANDSEED", "5", "100000",
        "0", "ENDSEC", "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "LTYPE", "5", "80", "70", "3",
    ]
    linetypes = {
        "CONTINUOUS": ("Сплошная", []),
        "DASHED": ("Штриховая", [3.0, -1.5]),
        "CENTER": ("Штрихпунктирная", [7.0, -1.5, 1.0, -1.5]),
    }
    for i, (name, (description, pattern)) in enumerate(linetypes.items(), start=1):
        lines += ["0", "LTYPE", "5", f"{i:X}", "100", "AcDbSymbolTableRecord",
                  "100", "AcDbLinetypeTableRecord", "2", name, "70", "0",
                  "3", description, "72", "65", "73", str(len(pattern)),
                  "40", str(sum(abs(v) for v in pattern))]
        for value in pattern:
            lines += ["49", str(value), "74", "0"]
    lines += ["0", "ENDTAB", "0", "TABLE", "2", "LAYER", "5", "81", "70", str(len(layers))]
    handle = 0x100
    for name, (color, lineweight, linetype) in layers.items():
        handle += 1
        lines += ["0", "LAYER", "5", f"{handle:X}", "100", "AcDbSymbolTableRecord",
                  "100", "AcDbLayerTableRecord", "2", name, "70", "0",
                  "62", str(color), "6", linetype, "370", str(lineweight)]
    lines += ["0", "ENDTAB", "0", "TABLE", "2", "STYLE", "5", "82", "70", "1",
              "0", "STYLE", "5", "200", "100", "AcDbSymbolTableRecord",
              "100", "AcDbTextStyleTableRecord", "2", "AC03GOST", "70", "0",
              "40", "0", "41", "1", "50", "0", "71", "0", "42", "2.5",
              "3", "GOST_BU.ttf", "4", "", "0", "ENDTAB", "0", "ENDSEC",
              "0", "SECTION", "2", "ENTITIES"]
    entity_handle = 0x1000
    for item in entities:
        offset = (item["sheet"] - 1) * (PAGE_W + DXF_GAP)
        layer = item["layer"]
        entity_handle += 1
        lines += ["0", item["type"].upper(), "5", f"{entity_handle:X}", "100", "AcDbEntity",
                  "8", layer]
        if item["type"] == "Line":
            a, b = item["start"], item["end"]
            lines += ["100", "AcDbLine", "10", str(a[0] + offset), "20", str(a[1]), "30", "0",
                      "11", str(b[0] + offset), "21", str(b[1]), "31", "0"]
        elif item["type"] == "Circle":
            x, y = item["center"]
            lines += ["100", "AcDbCircle", "10", str(x + offset), "20", str(y), "30", "0",
                      "40", str(item["radius"])]
        elif item["type"] == "Text":
            x, y = item["x"] + offset, item["y"]
            lines += ["100", "AcDbText", "1", dxf_text(item["value"]),
                      "10", str(x), "20", str(y), "30", "0",
                      "40", str(item["height"]), "50", str(item["rotation"]),
                      "41", "1", "51", "0", "7", "AC03GOST"]
            if item["align"] == "center":
                lines += ["72", "1", "73", "2", "11", str(x), "21", str(y), "31", "0"]
            else:
                lines += ["72", "0", "73", "0"]
        else:
            raise ValueError(f"Unsupported drawing entity: {item['type']}")
    lines += ["0", "ENDSEC", "0", "EOF"]
    path = DRAW / f"AC-03-drawings-{RELEASE}.dxf"
    # R2007+ DXF stores string values as UTF-8; $DWGCODEPAGE is legacy metadata.
    path.write_bytes(("\r\n".join(lines) + "\r\n").encode("utf-8"))
    return path


def audit_dxf(path: Path, entities: list[dict]) -> dict:
    """Check the emitted DXF's structure, version, units, layers and text round-trip."""
    issues = []
    try:
        raw = path.read_bytes()
        lines = raw.decode("utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as error:
        return {"path": path.name, "pass": False, "issues": [str(error)]}
    if len(lines) % 2:
        return {"path": path.name, "pass": False,
                "issues": ["DXF group-code/value line count is odd"]}
    pairs = [(lines[i].strip(), lines[i + 1]) for i in range(0, len(lines), 2)]

    def header_value(name: str):
        for i, (code, value) in enumerate(pairs[:-1]):
            if code == "9" and value == name:
                return pairs[i + 1][1]
        return None

    version = header_value("$ACADVER")
    units = header_value("$INSUNITS")
    codepage = header_value("$DWGCODEPAGE")
    if version != "AC1027":
        issues.append(f"expected DXF AC1027, got {version!r}")
    if units != "4":
        issues.append(f"expected millimetre INSUNITS=4, got {units!r}")

    layer_names = set()
    in_layer_table = False
    in_layer_record = False
    entity_start = entity_end = None
    for i, (code, value) in enumerate(pairs):
        if code == "0" and value == "TABLE" and i + 1 < len(pairs):
            in_layer_table = pairs[i + 1] == ("2", "LAYER")
            in_layer_record = False
        elif code == "0" and value == "ENDTAB":
            in_layer_table = False
            in_layer_record = False
        elif in_layer_table and code == "0":
            in_layer_record = value == "LAYER"
        elif in_layer_table and in_layer_record and code == "2":
            layer_names.add(value)
            in_layer_record = False
        if code == "2" and value == "ENTITIES":
            entity_start = i + 1
        elif entity_start is not None and code == "0" and value == "ENDSEC":
            entity_end = i
            break
    if entity_start is None or entity_end is None:
        return {"path": path.name, "version": version, "units": units,
                "pass": False, "issues": issues + ["ENTITIES section is missing or truncated"]}

    actual_types = []
    actual_text = []
    used_layers = set()
    for code, value in pairs[entity_start:entity_end]:
        if code == "0":
            actual_types.append(value)
        elif code == "8":
            used_layers.add(value)
        elif code == "1" and actual_types and actual_types[-1] == "TEXT":
            actual_text.append(re.sub(
                r"\\U\+([0-9A-Fa-f]{4})",
                lambda match: chr(int(match.group(1), 16)), value))
    if len(actual_types) != len(entities):
        issues.append(f"entity count mismatch: DXF={len(actual_types)}, source={len(entities)}")
    expected_types = [item["type"].upper() for item in entities]
    if actual_types != expected_types:
        issues.append("DXF entity type/order differs from the shared drawing source")
    expected_text = [item["value"] for item in entities if item["type"] == "Text"]
    if actual_text != expected_text:
        issues.append("DXF text does not round-trip to the shared drawing source")
    if used_layers - layer_names:
        issues.append(f"entities reference undefined layers: {sorted(used_layers - layer_names)}")
    expected_layers = {item["layer"] for item in entities} | {"0"}
    if expected_layers - layer_names:
        issues.append(f"required layers are missing: {sorted(expected_layers - layer_names)}")

    return {
        "path": path.name,
        "format": "DXF R2013 / AC1027",
        "version": version,
        "units_code": units,
        "units": "mm" if units == "4" else "unknown",
        "codepage_header": codepage,
        "encoding": "UTF-8",
        "entity_count": len(actual_types),
        "text_count": len(actual_text),
        "layer_count": len(layer_names),
        "layers": sorted(layer_names),
        "pass": not issues,
        "issues": issues,
    }


def layout_audit(entities: list[dict]) -> dict:
    issues = []
    counts = {str(i): 0 for i in range(1, SHEETS + 1)}
    text_boxes = {str(i): [] for i in range(1, SHEETS + 1)}
    for item in entities:
        sheet = item["sheet"]
        counts[str(sheet)] += 1
        if item["type"] != "Text":
            continue
        value, h = item["value"], item["height"]
        w = width_mm(value, h)
        x, y = item["x"], item["y"]
        if item["align"] == "center":
            x0, x1 = x - w / 2, x + w / 2
        else:
            x0, x1 = x, x + w
        if item["rotation"] % 180:
            cx = (x0 + x1) / 2
            cy = y + h * 0.2
            x0, x1 = cx - h * 0.6, cx + h * 0.6
            y0, y1 = cy - w / 2, cy + w / 2
        else:
            y0, y1 = y - h * 0.25, y + h * 0.85
        if x0 < 20 or x1 > 415 or y0 < 5 or y1 > 292:
            issues.append({"sheet": sheet, "value": value, "issue": "text outside frame"})
        cell = item.get("cell_bounds")
        if cell is not None and (x0 < cell[0] - 0.01 or x1 > cell[2] + 0.01
                                 or y0 < cell[1] - 0.01 or y1 > cell[3] + 0.01):
            issues.append({"sheet": sheet, "value": value, "issue": "table cell overflow",
                           "text_bounds": [round(x0, 3), round(y0, 3),
                                           round(x1, 3), round(y1, 3)],
                           "cell_bounds": cell})
        text_boxes[str(sheet)].append((x0, y0, x1, y1, value))
    overlaps = []
    for sheet, boxes in text_boxes.items():
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    overlaps.append({"sheet": int(sheet), "a": a[4], "b": b[4]})
    if overlaps:
        issues.extend({"issue": "text overlap", **entry} for entry in overlaps)
    if any(count == 0 for count in counts.values()):
        issues.append({"issue": "empty sheet"})

    def circle_centers(sheet_no: int, radius: float) -> set[tuple[float, float]]:
        return {
            (round(item["center"][0], 3), round(item["center"][1], 3))
            for item in entities
            if item["sheet"] == sheet_no and item["type"] == "Circle"
            and item["layer"] == "OUT" and abs(item["radius"] - radius) < 1e-6
        }

    design = json.loads((ROOT / "cad" / "design.json").read_text(encoding="utf-8"))
    base = design["parts"]["AC-03-001-base"]
    base_holes = base["pilot_holes"]
    lid_holes = design["parts"]["AC-03-002-lid"]["clearance_holes"]
    expected_base_sheet2 = {
        (round(42 + hole["center"][0], 3), round(132 + hole["center"][1], 3))
        for hole in base_holes
    }
    expected_lid_sheet3 = {
        (round(45 + hole["center"][0], 3), round(138 + hole["center"][1], 3))
        for hole in lid_holes
    }
    hole_checks = {
        "base_detail_matches_design": circle_centers(2, 1.25) == expected_base_sheet2,
        "lid_detail_matches_design": circle_centers(3, 1.7) == expected_lid_sheet3,
    }
    def rectangle_edges(x0: float, y0: float, x1: float, y1: float):
        return {
            tuple(sorted(((round(x0, 4), round(y0, 4)),
                          (round(x1, 4), round(y0, 4))))),
            tuple(sorted(((round(x1, 4), round(y0, 4)),
                          (round(x1, 4), round(y1, 4))))),
            tuple(sorted(((round(x1, 4), round(y1, 4)),
                          (round(x0, 4), round(y1, 4))))),
            tuple(sorted(((round(x0, 4), round(y1, 4)),
                          (round(x0, 4), round(y0, 4))))),
        }

    actual_sheet2_thin_edges = {
        tuple(sorted((tuple(item["start"]), tuple(item["end"]))))
        for item in entities
        if item["sheet"] == 2 and item["type"] == "Line" and item["layer"] == "THIN"
    }
    apertures = {item["name"]: item for item in base["apertures"]}
    rear_aperture = apertures["rear signal cable passage"]
    rear_scale = 0.5
    rear_origin = (42.0, 55.0)
    x, _, z = rear_aperture["p"]
    width, _, height = rear_aperture["size"]
    base_width = base["outer"]["size"][0]
    x0 = rear_origin[0] + (base_width - x - width) * rear_scale
    y0 = rear_origin[1] + z * rear_scale
    expected_rear_edges = rectangle_edges(
        x0, y0, x0 + width * rear_scale, y0 + height * rear_scale)
    hole_checks["rear_view_opening_matches_design"] = (
        expected_rear_edges <= actual_sheet2_thin_edges)

    usb_aperture = apertures["USB service aperture"]
    front_origin = (222.0, 170.0)
    x, _, z = usb_aperture["p"]
    width, _, height = usb_aperture["size"]
    expected_usb_edges = rectangle_edges(
        front_origin[0] + x, front_origin[1] + z,
        front_origin[0] + x + width, front_origin[1] + z + height)
    hole_checks["front_usb_opening_matches_design"] = (
        expected_usb_edges <= actual_sheet2_thin_edges)
    datum_note = "Координаты X/Y/Z отсчитывать от наружного нижнего переднего левого угла основания."
    hole_checks["coordinate_datum_is_defined"] = any(
        item["sheet"] == 2 and item["type"] == "Text" and item["value"] == datum_note
        for item in entities)
    for check, passed in hole_checks.items():
        if not passed:
            issues.append({"issue": "drawing/design hole coordinate mismatch", "check": check})

    return {"release": RELEASE, "page_size_mm": [PAGE_W, PAGE_H],
            "sheets": SHEETS, "entity_count_by_sheet": counts,
            "text_overlap_count": len(overlaps),
            "table_cell_overflow_count": sum(1 for item in issues
                                             if item.get("issue") == "table cell overflow"),
            "geometry_checks": hole_checks,
            "issues": issues,
            "pass": not issues}


def main():
    global RELEASE
    parser = argparse.ArgumentParser(description="Generate AC-03 A3 drawings and DXF")
    parser.add_argument("--release", default="R02",
                        help="release label (default: current release R02; use R01 for the archive)")
    parser.add_argument("--overwrite", action="store_true",
                        help="replace outputs of the selected release")
    args = parser.parse_args()
    if not args.release.startswith("R") or not args.release[1:].isdigit():
        parser.error("--release must look like R02")
    RELEASE = args.release
    DRAW.mkdir(parents=True, exist_ok=True)
    targets = [
        DRAW / f"AC-03-drawings-{RELEASE}.pdf",
        DRAW / f"AC-03-drawings-{RELEASE}.dxf",
        DRAW / f"drawing-entities-{RELEASE}.json",
        DRAW / f"layout-audit-{RELEASE}.json",
    ]
    existing = [path for path in targets if path.exists()]
    if existing and not args.overwrite:
        parser.error("release output already exists; pass --overwrite to replace it: "
                     + ", ".join(path.name for path in existing))
    entities = build_geometry()
    json_path = DRAW / f"drawing-entities-{RELEASE}.json"
    json_path.write_text(json.dumps(entities, ensure_ascii=False, indent=2), encoding="utf-8")
    pdfs = render_pdf(entities)
    dxf = render_dxf(entities)
    dxf_audit = audit_dxf(dxf, entities)
    audit = layout_audit(entities)
    audit["dxf_audit"] = dxf_audit
    if not dxf_audit["pass"]:
        audit["issues"].append({"issue": "DXF structural audit failed",
                                "details": dxf_audit["issues"]})
        audit["pass"] = False
    page_text = []
    for page_no in range(1, SHEETS + 1):
        page_text.append(sum(len(e["value"]) for e in entities
                             if e["sheet"] == page_no and e["type"] == "Text"))
    pdf_info = {"combined_pdf": pdfs[0].relative_to(ROOT).as_posix(),
                "expected_pages": SHEETS, "page_size_mm": [PAGE_W, PAGE_H],
                "source_text_characters": page_text,
                "font": "GOST Type BU embedded for PDF"}
    if not audit["pass"]:
        (DRAW / f"layout-audit-{RELEASE}.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
        raise RuntimeError(f"Drawing layout audit failed: {json.dumps(audit, ensure_ascii=False)}")
    (DRAW / f"layout-audit-{RELEASE}.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"pdf": pdf_info, "dxf": dxf.relative_to(ROOT).as_posix(),
                      "entity_count": len(entities), "layout_audit": audit}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
