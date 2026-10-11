"""Deterministic AC-02 R04 drawing source in millimetres.

The same entity list feeds the A3 PDFs and the editable OpenCAD Studio DWG.
The assembly view follows the common Y datum in the CSG model; electronic
reference fidelity is called out according to the actual source geometry.
"""
import json
import re
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
pdfmetrics.registerFont(TTFont("DrawingGOST", r"C:\Windows\Fonts\GOST_BU.ttf"))
FONT_FACE = pdfmetrics.getFont("DrawingGOST").face

E = []
offset = 0
RELEASE = "R04"


def text_width(value, height):
    # height is in drawing mm. Convert it to points before measuring the
    # TrueType font, then convert the measured width back to mm.
    size = height * 72 / 25.4 * 1000 / FONT_FACE.capHeight
    return pdfmetrics.stringWidth(value, "DrawingGOST", size) * 25.4 / 72


def line(x1, y1, x2, y2, layer="D-OUTLINE"):
    E.append({"type": "Line", "layer": layer,
              "start": [x1 + offset, y1, 0], "end": [x2 + offset, y2, 0]})


def rect(x, y, width, height, layer="D-OUTLINE"):
    line(x, y, x + width, y, layer)
    line(x + width, y, x + width, y + height, layer)
    line(x + width, y + height, x, y + height, layer)
    line(x, y + height, x, y, layer)


def circle(x, y, radius, layer="D-OUTLINE"):
    E.append({"type": "Circle", "layer": layer,
              "center": [x + offset, y, 0], "radius": radius})


def text(x, y, value, height=3.5, angle=0, layer="D-TEXT"):
    value = re.sub(r"(?<=\d)\.(?=\d)", ",", value)
    E.append({"type": "Text", "layer": layer,
              "position": [x + offset, y, 0], "height": height,
              "value": value, "rotation": angle})


def cell_text(x, y, width, height, value, size=2.4):
    baseline = y + (height - size) / 2 + 0.15
    # OpenCAD's Standard/txt.shx font is fixed-width at 0.6 drawing units
    # per character-height. Keep the editable DWG centered using that metric;
    # store the GOST BU position separately for the TrueType PDF renderer.
    cad_width = len(value) * size * 0.6
    cad_x = x + (width - cad_width) / 2
    pdf_x = x + (width - text_width(value, size)) / 2
    text(cad_x, baseline, value, size)
    E[-1]["_pdf_position"] = [pdf_x + offset, baseline, 0]
    E[-1]["_cell"] = [x + offset, y, width, height]


def cross(x, y, radius=3.0):
    line(x - radius, y, x + radius, y, "D-CENTER")
    line(x, y - radius, x, y + radius, "D-CENTER")


def dimx(a, b, y, extension, label):
    line(a, extension, a, y + 1.6, "D-DIM")
    line(b, extension, b, y + 1.6, "D-DIM")
    line(a, y, b, y, "D-DIM")
    for x, sign in ((a, 1), (b, -1)):
        line(x, y, x + sign * 2.5, y + 0.8, "D-DIM")
        line(x, y, x + sign * 2.5, y - 0.8, "D-DIM")
    text((a + b - text_width(label, 3.5)) / 2, y + 1.9, label, 3.5)


def dimy(a, b, x, extension, label):
    line(extension, a, x - 1.6, a, "D-DIM")
    line(extension, b, x - 1.6, b, "D-DIM")
    line(x, a, x, b, "D-DIM")
    for y, sign in ((a, 1), (b, -1)):
        line(x, y, x - 0.8, y + sign * 2.5, "D-DIM")
        line(x, y, x + 0.8, y + sign * 2.5, "D-DIM")
    text(x - 5.5, (a + b - text_width(label, 3.5)) / 2,
         label, 3.5, 90)


def notes(x, y, rows, size=3.2, step=7.5):
    for i, value in enumerate(rows):
        text(x, y - i * step, value, size)


def hatch_box(x, y, width, height, spacing=3.0, slope=1):
    """Draw clipped 45-degree section hatching inside one rectangular part."""
    t = -height
    while t <= width + height:
        if slope > 0:
            candidates = [(0, -t), (width, width - t),
                          (t, 0), (height + t, height)]
        else:
            candidates = [(0, t), (width, t - width),
                          (t, 0), (t - height, height)]
        points = []
        for px, py in candidates:
            if -1e-8 <= px <= width + 1e-8 and -1e-8 <= py <= height + 1e-8:
                point = (round(x + min(width, max(0, px)), 6),
                         round(y + min(height, max(0, py)), 6))
                if point not in points:
                    points.append(point)
        if len(points) >= 2:
            a, b = max(((p1, p2) for i, p1 in enumerate(points)
                        for p2 in points[i + 1:]),
                       key=lambda pair: (pair[0][0] - pair[1][0]) ** 2
                                        + (pair[0][1] - pair[1][1]) ** 2)
            line(a[0], a[1], b[0], b[1], "D-DETAIL")
        t += spacing


def arrow_line(x1, y1, x2, y2, head=1.8, layer="D-DETAIL"):
    """Draw a straight arrow using native line entities."""
    dx, dy = x2 - x1, y2 - y1
    length = (dx * dx + dy * dy) ** 0.5
    if length <= 1e-9:
        return
    ux, uy = dx / length, dy / length
    bx, by = x2 - head * ux, y2 - head * uy
    px, py = -uy * head * 0.55, ux * head * 0.55
    line(x1, y1, x2, y2, layer)
    line(x2, y2, bx + px, by + py, layer)
    line(x2, y2, bx - px, by - py, layer)


def frame(number, title, designation, name, material="Материал не назначен", scale="1:1"):
    global offset
    offset = (number - 1) * 450
    rect(20, 5, 395, 287)
    text(26, 282, title, 4.6)
    text(26, 274, f"AirCheck | наружный измерительный узел | {RELEASE} | размеры в мм", 3.2)

    # Compact ESKD-style title block with deliberate text clearance from rules.
    rect(230, 5, 185, 55)
    line(295, 5, 295, 60)
    line(295, 45, 415, 45)
    line(295, 20, 415, 20)
    line(365, 5, 365, 45)
    line(365, 30, 415, 30)
    line(380, 30, 380, 45)
    line(395, 30, 395, 45)
    line(390, 20, 390, 30)
    for y in range(10, 61, 5):
        line(230, y, 295, y, "D-DETAIL")
    for x in (250, 267, 282):
        line(x, 5, x, 60, "D-DETAIL")
    cell_text(230, 50, 20, 5, "Изм.")
    cell_text(250, 50, 17, 5, "Лист")
    cell_text(267, 50, 15, 5, "Подп.")
    cell_text(282, 50, 13, 5, "Дата")
    text(298, 50, designation, 4.0)
    text(298, 35, name, 3.2)
    cell_text(365, 38, 15, 7, "Лит.")
    cell_text(380, 38, 15, 7, "Масса")
    cell_text(395, 38, 20, 7, "Масш.")
    cell_text(365, 30, 15, 8, "П", 3.2)
    cell_text(395, 30, 20, 8, scale, 3.2)
    text(367, 23, f"Лист {number}", 2.3)
    text(392, 23, "Листов 6", 2.3)
    text(298, 11, material, 3.0)
    text(368, 11, "AirCheck / ВКР", 2.3)
    for i, label in enumerate(("Разраб.", "Проверил", "Т. контр.", "Н. контр.", "Утв.")):
        cell_text(230, 25 - 5 * i, 20, 5, label, 2.2)
    text(26, 7, "А3 420 x 297; печать 100%; контроль 100 мм", 2.35)
    text(178, 7, "Неуказанные ±0.3 мм", 2.35)


def base_top(x, y, electronics=True):
    rect(x, y, 160, 180)
    rect(x + 4, y + 4, 152, 172, "D-DETAIL")
    for px in (8, 152):
        for py in (30, 162):
            circle(x + px, y + py, 2.25)
            cross(x + px, y + py, 4)
    for px in (14, 146):
        for py in (14, 166):
            # Screw pilot boss: Ø8.4 outside, Ø2.5 pilot through its top.
            circle(x + px, y + py, 4.2, "D-DETAIL")
            circle(x + px, y + py, 1.25)
            cross(x + px, y + py, 4.8)
    # SHT45 breakout standoffs and camera screen perimeter.
    for px in (16.54, 36.86):
        for py in (30.54, 43.24):
            circle(x + px, y + py, 1.05)
            circle(x + px, y + py, 2.5, "D-DETAIL")
            cross(x + px, y + py, 3.3)
    rect(x + 4.3, y + 20, 40.7, 34, "D-DETAIL")
    # Two open-end lugs and their through-holes retain the actual screen footprint.
    for yy in (20, 48):
        rect(x + 40, y + yy, 16, 6, "D-DETAIL")
    for yy in (24, 50):
        circle(x + 52, y + yy, 3.5, "D-DETAIL")
        circle(x + 52, y + yy, 1.25)
        cross(x + 52, y + yy, 4.5)
    # SPS30 envelope and its two air-port zones are shown as references.
    rect(x + 90, y + 4.5, 41.2, 41.2, "D-REF")
    rect(x + 92, y + 4, 18, 4, "D-DETAIL")
    rect(x + 112, y + 4, 18, 4, "D-DETAIL")
    # ESP32 rotated so the micro-USB connector faces the left wall.
    rect(x + 14, y + 80, 48.26, 27.94, "D-REF")
    rect(x + 4, y + 89.44, 10, 9, "D-REF")
    rect(x + 14, y + 28, 25.4, 17.78, "D-REF")
    rect(x + 25.5, y + 35.69, 2.4, 2.4, "D-DETAIL")
    # Inner support rails and perimeter tie slots.
    for px in (87.9, 131.2):
        rect(x + px, y + 8, 2.1, 36, "D-DETAIL")
    # Eight 3 x 5 mm floor slots, matching the CSG cut locations exactly.
    for px in (9, 65):
        for py in (79, 105):
            rect(x + px, y + py, 3, 5, "D-DETAIL")
    for px in (83, 136):
        for py in (15, 35):
            rect(x + px, y + py, 3, 5, "D-DETAIL")
    for py in (24, 34, 44):
        rect(x, y + py, 4, 6, "D-DETAIL")


def sheet_assembly():
    frame(1, "Узел наружный измерительный. Сборочный чертёж",
          "AC-02-000 СБ", "Узел наружный измерительный")
    # Plan, with lid removed. Dashed rectangles are device envelopes / roof.
    rect(36, 78, 176, 190, "D-REF")
    # Base and hood share the Y=0 datum in the assembly CSG model. The hood
    # is 10 mm deeper than the base, so the overhang is at the rear only.
    base_top(44, 78)
    for x in (52, 196):
        for y in (108, 240):
            circle(x, y, 2.25, "D-REF")
    # Item numbers follow AC-02-000 СП; labels sit next to the matching model.
    text(178, 127, "8  SPS30", 3.1)
    text(58, 136, "7  SHT45 #5665", 3.1)
    text(110, 170, "6  ESP32", 3.1)
    dimx(36, 212, 70, 78, "176")
    dimy(78, 268, 33, 36, "190")

    # Front elevation through the SPS30 port side.
    x, y = 36, 14
    rect(x, y, 88, 45)
    rect(x + 4, y + 2, 80, 30)
    rect(x + 4, y + 32, 80, 1.5, "D-DETAIL")
    rect(x, y + 43, 88, 2, "D-DETAIL")
    rect(x, y, 2, 43, "D-DETAIL")
    rect(x + 86, y, 2, 43, "D-DETAIL")
    rect(x + 4 + 46, y + 11, 9, 12, "D-DETAIL")
    rect(x + 4 + 56, y + 11, 9, 12, "D-DETAIL")
    text(36, 62.5, "Вид спереди, 1:2", 2.8)

    # Section A-A follows one SPS30 port axis (X=101 from the base datum).
    # The arrows point toward -X; the section view therefore shows Y increasing
    # to the right. The view is derived from the R01 housing dimensions.
    cut_x = 44 + 101
    line(cut_x, 78, cut_x, 268, "D-CENTER")
    arrow_line(cut_x + 4.5, 268, cut_x, 268, head=2.0)
    arrow_line(cut_x + 4.5, 78, cut_x, 78, head=2.0)
    text(cut_x + 6, 269, "А", 2.5)
    text(cut_x + 6, 73.5, "А", 2.5)

    # Cross-section in the empty lower-right area, scale 1:2. It cuts the
    # actual 18 x 24 mm base opening; the SPS30 is shown as a dashed envelope,
    # not as a fictitious cut through its internal airflow channels.
    vx, vy = 130, 12
    sx = lambda yy: vx + yy * 0.5
    sz = lambda zz: vy + (zz + 4) * 0.5

    # Hood roof and rear wall: front and bottom stay open in the model.
    roof = (vx, sz(82), 95, 2)
    rear = (sx(185.8), sz(-4), 2.1, sz(82) - sz(-4))
    rect(*roof, "D-OUTLINE")
    hatch_box(*roof, spacing=3.0, slope=1)
    rect(*rear, "D-OUTLINE")
    hatch_box(*rear, spacing=3.0, slope=-1)

    # Base section at X=101: the plane crosses the first port window, floor,
    # rear wall and fitted lid. The 4 mm front wall is open from Z=18 to 42.
    front_lower = (vx, sz(0), 2, sz(18) - sz(0))
    front_upper = (vx, sz(42), 2, sz(60) - sz(42))
    floor = (sx(4), sz(0), sx(176) - sx(4), 2)
    base_rear = (sx(176), sz(0), 2, sz(60) - sz(0))
    lid = (sx(0), sz(60), sx(180) - sx(0), 1.5)
    for shape in (front_lower, front_upper, floor, base_rear):
        rect(*shape, "D-OUTLINE")
        hatch_box(*shape, spacing=2.7, slope=1)
    rect(*lid, "D-OUTLINE")
    hatch_box(*lid, spacing=2.7, slope=-1)

    # Manufacturer model is represented by its section-plane envelope.
    sps30_envelope = (sx(4.8), sz(22.3),
                      sx(45.4) - sx(4.8), sz(34.5) - sz(22.3))
    rect(*sps30_envelope, "D-REF")
    text(sx(4.8) + 1, sz(34.5) + 1.2, "SPS30 REF", 2.2)
    arrow_line(sx(-9), sz(28.0), sx(4.6), sz(28.0), head=1.4)
    arrow_line(sx(4.6), sz(30.0), sx(-9), sz(30.0), head=1.4)
    text(vx, 61, "Разрез А-А через порт SPS30, 1:2", 2.6)
    notes(238, 128, [
        "А-А: плоскость X=101 мм от начала основания.",
        "Окно в стенке: 18 × 24 мм; показана связь",
        "с портовой стороной SPS30. Контур датчика REF.",
        "Внутренние каналы и расход воздуха не моделировались.",
    ], 2.6, 4.8)
    notes(238, 278, [
        "Состав и ориентация", "1 — основание AC-02-001, 1 шт.",
        "2 — крышка AC-02-002, 1 шт.", "3 — козырёк AC-02-003, 1 шт.",
        "4 — кронштейн AC-02-004, 1 шт.", "5 — экран камеры AC-02-005, 1 шт.",
        "6 — ESP32-DevKitC-32E V4, 1 шт.",
        "7 — Adafruit SHT45 #5665, без PTFE, 1 шт.",
        "8 — Sensirion SPS30, 1 шт.",
        "6 — ESP32 LOD0; 7–8 — модели STEP, не печатать.",
        "Условие: под навесом, без прямых осадков и солнца.",
        "SPS30: порты обращены к Y=0; не закрывать перед ними",
        "свободное пространство. ESP32: USB обращён к X=0.",
        "SHT45 отделён экраном; его отверстия не герметизировать.",
        "Питание 5 В; соединения см. схему AC-02.",
        "Установка: кронштейн к основанию стены подходящими",
        "анкерами; длину крепежа проверить по толщине основания.",
        "Посадки, материал и печать конкретным принтером не проверены.",
        "Не заявлены IP, климатическое исполнение или точность",
        "измерений после установки в корпус.",
    ], 3.0, 7.2)


def sheet_base():
    frame(2, "Основание корпуса",
          "AC-02-001", "Основание корпуса")
    base_top(35, 89)
    dimx(35, 195, 82, 89, "160 ±0.3")
    dimy(89, 269, 33, 35, "180 ±0.3")

    # Port wall Y=0, with aperture centers dimensioned from X origin.
    rect(35, 18, 160, 60)
    rect(35 + 92, 18 + 18, 18, 24, "D-DETAIL")
    rect(35 + 112, 18 + 18, 18, 24, "D-DETAIL")
    dimx(35 + 92, 35 + 130, 10, 18, "38")
    dimy(18, 78, 205, 195, "60 ±0.3")

    # X=0 wall: three SHT45 exchange slots and the micro-USB window.
    rect(230, 164, 180, 60)
    for yy in (24, 34, 44):
        rect(230 + yy, 164 + 16, 6, 12, "D-DETAIL")
    rect(230 + 88.5, 164 + 15.5, 11, 7, "D-DETAIL")
    text(230, 231, "Вид слева: X=0; SHT45 и USB ESP32", 2.9)
    dimx(230 + 88.5, 230 + 99.5, 157, 164, "11")

    notes(230, 145, [
        "Основание, вид изнутри; начало координат в углу дна.",
        "Габарит 160 × 180 × 60; стенки и дно 4 мм.",
        "Крышка: пилоты Ø2.5, X=14/146; Y=14/166.",
        "Крепёж корпуса Ø4.5, X=8/152; Y=30/162.",
        "Опоры SHT45 Ø5; пилоты Ø2.1, глубина 10; экран",
        "X=4.3..45, Y=20..54; зазор сенсор–крышка 5.2 мм.",
        "Крепёж экрана Ø2.5; X=52; Y=24/50.",
        "SPS30: полки X=90/131.2; верх направляющих Z=36.3.",
        "USB-окно 11 × 7; проверить штекер и изгиб кабеля.",
        "Окна SHT45: 3 × (6 × 12), Y=24/34/44, Z=16..28.",
        "Прорези дна 3 × 5: X=9/65, Y=79/105; X=83/136,",
        "Y=15/35 (все сочетания координат).",
        "Неуказанные ±0.3; посадки проверить образцом; перед",
        "сверлением снять платы и кабели.",
    ], 2.8, 6.4)


def sheet_lid():
    frame(3, "Крышка корпуса",
          "AC-02-002", "Крышка корпуса")
    x, y = 35, 85
    rect(x, y, 160, 180)
    rect(x + 4.3, y + 4.3, 151.4, 171.4, "D-DETAIL")
    rect(x + 7.3, y + 7.3, 145.4, 165.4, "D-DETAIL")
    for px in (14, 146):
        for py in (14, 166):
            circle(x + px, y + py, 1.7)
            cross(x + px, y + py, 3)
    dimx(x, x + 160, 77, y, "160 ±0.3")
    dimy(y, y + 180, 33, x, "180 ±0.3")
    dimx(x + 14, x + 146, 69, y + 14, "132")
    text(36, 268, "Вид изнутри; сопрягаемый бортик обращён к основанию", 2.8)

    # Edge section at the left of the sheet: plate plus downturned lip.
    sx, sy = 36, 50
    line(sx, sy, sx + 160, sy, "D-OUTLINE")
    line(sx, sy + 3, sx + 160, sy + 3, "D-OUTLINE")
    line(sx + 4.3, sy - 3.5, sx + 4.3, sy, "D-OUTLINE")
    line(sx + 7.3, sy - 3.5, sx + 7.3, sy, "D-OUTLINE")
    line(sx + 152.7, sy - 3.5, sx + 152.7, sy, "D-OUTLINE")
    line(sx + 155.7, sy - 3.5, sx + 155.7, sy, "D-OUTLINE")
    line(sx + 4.3, sy - 3.5, sx + 7.3, sy - 3.5, "D-OUTLINE")
    line(sx + 152.7, sy - 3.5, sx + 155.7, sy - 3.5, "D-OUTLINE")
    text(36, 42, "Местное сечение бортика; не в масштабе", 2.8)

    notes(230, 277, [
        "Размеры и печать", "Наружный размер 160 × 180; пластина 3 мм.",
        "Бортик: 151.4 × 171.4 × 3.7; выступ внутрь 3.5.",
        "Зазор бортик–стенка основания: 0.3 мм на сторону.",
        "4 сквозных отверстия Ø3.4; центры X=14/146,",
        "Y=14/166 от начала координат основания.",
        "Плоскость стыка Z=60; верх крышки Z=63.",
        "ST2.9 × 12 — предварительный крепёж в пилот Ø2.5.",
        "Резьбу в крышке не нарезать; проверить винтом образец.",
        "Печатать наружной плоскостью вниз; отверстия проверить",
        "на усадку и удаление нитей перед сборкой.",
        "Неуказанные линейные размеры ±0.3 мм.",
        "Крышка не является уплотнённой и не задаёт класс IP.",
        "Перед снятием отключить питание и снять внешнее питание.",
    ], 3.0, 8.0)


def sheet_hood():
    frame(4, "Козырёк и экран наружного узла",
          "AC-02-003", "Козырёк-экран")
    # Plan: cavity and four mounting tabs, scale 1:2.
    x, y = 36, 170
    rect(x, y, 88, 95)
    rect(x + 2, y, 84, 93, "D-DETAIL")
    for px in (8, 152):
        for py in (30, 162):
            rect(x + px / 2 - 5, y + py / 2 - 6, 10, 12, "D-DETAIL")
            circle(x + px / 2, y + py / 2, 1.125)
            cross(x + px / 2, y + py / 2, 2)
    dimx(x, x + 88, 162, y, "176")
    dimy(y, y + 95, 33, x, "190")
    text(36, 269, "Вид сверху, 1:2; размеры указаны номинальные", 2.8)

    # Front elevation: 4 mm roof and 4 mm side walls.
    fx, fy = 36, 25
    rect(fx, fy, 176, 90)
    rect(fx + 4, fy, 168, 86, "D-DETAIL")
    rect(fx, fy + 86, 176, 4, "D-OUTLINE")
    rect(fx, fy, 4, 86, "D-OUTLINE")
    rect(fx + 172, fy, 4, 86, "D-OUTLINE")
    dimy(fy, fy + 90, 224, 212, "90")

    # Side elevation of the open-bottom hood with a 4 mm rear wall.
    sx, sy = 225, 110
    rect(sx, sy, 95, 45)
    line(sx, sy + 43, sx + 95, sy + 43, "D-DETAIL")
    line(sx + 93, sy, sx + 93, sy + 43, "D-DETAIL")
    text(sx, sy + 48, "Вид сбоку, 1:2; задняя стенка 4 мм", 2.6)

    notes(225, 279, [
        "Печатная деталь AC-02-003", "Габарит 176 × 190 × 90 мм.",
        "Козырёк: крыша 4 мм; боковины 4 мм; стенка сзади 4 мм.",
        "Передняя сторона и низ открыты; не перекрывать порты SPS30.",
        "4 интегральных монтажных площадки 20 × 24 × 4.",
        "Отверстия Ø4.5; X=8/152, Y=30/162.",
        "При монтаже проверить фактический стык площадок",
        "с основанием AC-02-001 и кронштейном AC-02-004.",
        "Навес защищает от прямых осадков по исходному условию.",
        "Не являются целью: прямой дождь, брызги, мойка, UV-ресурс.",
        "Уплотнение, дренаж и IP не предусмотрены / не испытаны.",
        "Печатать крышей на стол; для ASA проверить коробление.",
        "Поддержки: по решению слайсера; не оставлять их в проёмах.",
        "Перед печатью проверить поле не менее 176 × 190 × 90 мм.",
    ], 2.8, 7.0)


def sheet_bracket():
    frame(5, "Кронштейн настенный",
          "AC-02-004", "Кронштейн настенный")
    x, y = 36, 114
    # Print orientation, top view of the U-frame and four standoffs.
    rect(x, y, 160, 156)
    rect(x + 16, y + 24, 128, 108, "D-DETAIL")
    rect(x, y, 16, 156, "D-DETAIL")
    rect(x + 144, y, 16, 156, "D-DETAIL")
    rect(x, y, 160, 24, "D-DETAIL")
    rect(x, y + 132, 160, 24, "D-DETAIL")
    for px in (8, 152):
        for py in (12, 144):
            rect(x + px - 6, y + py - 6, 12, 12, "D-DETAIL")
            circle(x + px, y + py, 2.25)
            cross(x + px, y + py, 4)
    dimx(x, x + 160, 106, y, "160 ±0.3")
    dimy(y, y + 156, 33, x, "156 ±0.3")
    dimx(x + 8, x + 152, 98, y + 12, "144")

    # Edge view / section: 3 mm back frame plus 5 mm pads.
    ex, ey = 36, 70
    rect(ex, ey, 160, 3)
    for px in (2, 146):
        for py in (0, 132):
            rect(ex + px, ey + 3, 12, 5, "D-DETAIL")
    text(36, 60, "Профиль в печатном положении; толщина до 8 мм", 2.8)

    notes(230, 278, [
        "Размеры и крепление", "Внешний габарит 160 × 156 × 8 мм.",
        "Рамка 3 мм; интегральные площадки 12 × 12; выступ 5 мм.",
        "4 сквозных отверстия Ø4.5; центры печатной модели",
        "X=8/152, Y=12/144; шаг 144 × 132.",
        "Ориентация: плоская сторона рамки на стол; без масштаба.",
        "Крепёж к зданию выбирается по материалу стены и анкерам.",
        "Ориентир — 4 шурупа/винта Ø4 мм; длину считать по месту.",
        "Толщина узла от стены до корпуса около 12 мм; добавить",
        "необходимую глубину заделки в выбранный анкер.",
        "Не сверлить стену по одному только STL: разметить шаблон.",
        "Под навесом; оценить ветровую нагрузку на площадке.",
        "Печатный кронштейн не является расчётным креплением",
        "для строительных конструкций или безопасности людей.",
        "Прочность, ползучесть и вырыв анкера не испытаны.",
    ], 3.0, 7.3)


def sheet_screen():
    frame(6, "Экран датчика температуры и влажности",
          "AC-02-005", "Экран камеры SHT45", scale="2:1")
    # Main view is enlarged 2:1 but all dimension values remain nominal.
    x, y = 36, 172
    # Roof occupies x=0..40.7; mounting wings extend to 51.7.
    rect(x, y, 81.4, 68)
    rect(x + 72.2, y + 0, 6, 68, "D-DETAIL")
    rect(x, y, 65.8, 6, "D-DETAIL")
    rect(x, y + 62, 65.8, 6, "D-DETAIL")
    rect(x + 71.4, y, 32, 12, "D-DETAIL")
    rect(x + 71.4, y + 56, 32, 12, "D-DETAIL")
    # SHT45 PCB and die outline are references, not printed geometry.
    rect(x + 19.4, y + 16, 50.8, 35.56, "D-REF")
    rect(x + 42.4, y + 31.38, 4.8, 4.8, "D-DETAIL")
    for px, py in ((x + 24.48, y + 21.08), (x + 65.12, y + 21.08),
                   (x + 24.48, y + 46.48), (x + 65.12, y + 46.48)):
        circle(px, py, 2.5, "D-REF")
    for py in (y + 8, y + 60):
        circle(x + 95.4, py, 3.4, "D-OUTLINE")
        cross(x + 95.4, py, 5)
    dimx(x, x + 103.4, 164, y, "51.7")
    dimy(y, y + 68, 33, x, "34")
    text(36, 245, "Вид изнутри; масштаб 2:1; PCB показана штриховой", 2.9)

    # Printed side profile in print orientation, total Z=9.2.
    sx, sy = 36, 88
    rect(sx, sy, 68, 6)
    rect(sx, sy + 5.6, 6, 12.8, "D-DETAIL")
    rect(sx + 62, sy + 5.6, 6, 12.8, "D-DETAIL")
    text(sx, sy + 23, "Профиль детали; масштаб 2:1", 2.8)
    dimy(sy, sy + 18.4, 146, sx + 103.4, "9.2")

    notes(230, 277, [
        "Воздушный экран SHT45", "Печатный габарит 51.7 × 34 × 9.2 мм.",
        "Крыша 40.7 × 34 × 3 мм; стенки 6.4 мм.",
        "Правая стенка смещена наружу для зазора до PCB.",
        "2 монтажных отверстия Ø3.4; X=47.7; Y=4/30 от",
        "нижнего угла печатной детали. Центры PCB — по плате.",
        "PCB Adafruit #5665: 25.4 × 17.78; 4 отв. Ø2.5.",
        "Позиция платы в основании: X=14; Y=28; Z=18.",
        "Кристалл SHT45: центр X=26.7; Y=36.89; верх Z около 20.6.",
        "Зазор до крыши — 5.2 мм; не касаться кристалла.",
        "Лицевая сторона с чувствительным элементом обращена",
        "к открытому объёму под крышей. Не наносить герметик.",
        "Вентиляция через отверстия основания X=0; проход не",
        "уменьшать клеем, пеной, фильтром или краской.",
        "Узел защищает от прямого касания и части излучения,",
        "но не является радиационным экраном по испытаниям.",
        "Пилотные отверстия в основании Ø2.5; крепёж ST2.9 × 12",
        "предварительный — проверить материалом и образцом.",
        "Неуказанные линейные размеры ±0.3 мм.",
    ], 2.85, 7.0)


if __name__ == "__main__":
    sheet_assembly()
    sheet_base()
    sheet_lid()
    sheet_hood()
    sheet_bracket()
    sheet_screen()
    path = ROOT / "drawings" / "drawing-entities.json"
    path.write_text(json.dumps(E, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"entities": len(E), "sheets": 6, "format": "A3",
                      "units": "mm", "source": str(path)}, ensure_ascii=False))
