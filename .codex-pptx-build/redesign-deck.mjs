import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "C:\\Users\\admin\\Desktop\\ВКР";
const buildDir = path.join(workspaceDir, ".codex-pptx-build");
const candidatePath = path.join(buildDir, "aircheck-redesign-draft.pptx");
const skillDir = "C:\\Users\\admin\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.905.11957\\skills\\presentations";

await fs.mkdir(buildDir, { recursive: true });

const heroRoomBytes = await fs.readFile(path.join(buildDir, "aircheck-hero-room.png"));
const roomContextBytes = await fs.readFile(path.join(buildDir, "aircheck-room-context.png"));

const { resolvePresentationFont } = await import(
  pathToFileURL(path.join(skillDir, "container_tools", "artifact_tool_utils.mjs")).href,
);

const FONT = resolvePresentationFont({ fontFamily: "Helvetica Neue" });
const W = 1280;
const H = 720;

const C = {
  canvas: "#FFFFFF",
  soft: "#F8F9FA",
  card: "#F5F5F5",
  ink: "#111111",
  body: "#374151",
  muted: "#6B7280",
  mutedSoft: "#898989",
  hairline: "#E5E7EB",
  hairlineSoft: "#F3F4F6",
  blue: "#3B82F6",
  blueSoft: "#EFF6FF",
};

const NO_LINE = { style: "solid", fill: "none", width: 0 };

function addShape(slide, geometry, position, fill = "none", line = NO_LINE) {
  return slide.shapes.add({ geometry, position, fill, line });
}

function addText(slide, text, options = {}) {
  const {
    left = 0,
    top = 0,
    width = 200,
    height = 40,
    size = 18,
    color = C.body,
    bold = false,
    align = "left",
    valign = "top",
    italic = false,
    autoFit = "shrinkText",
    wrap = "square",
    insets = { top: 0, right: 0, bottom: 0, left: 0 },
  } = options;
  const shape = slide.shapes.add({
    geometry: "textbox",
    position: { left, top, width, height },
    fill: "none",
    line: NO_LINE,
  });
  shape.text = text;
  shape.text.style = {
    typeface: FONT,
    fontSize: size,
    color,
    bold,
    italic,
    alignment: align,
    verticalAlignment: valign,
    autoFit,
    wrap,
    insets,
  };
  return shape;
}

function ruleH(slide, left, top, width, color = C.hairline, thickness = 1) {
  return addShape(
    slide,
    "rect",
    { left, top, width, height: thickness },
    color,
    NO_LINE,
  );
}

function ruleV(slide, left, top, height, color = C.hairline, thickness = 1) {
  return addShape(
    slide,
    "rect",
    { left, top, width: thickness, height },
    color,
    NO_LINE,
  );
}

function line(slide, x1, y1, x2, y2, color = C.hairline, width = 1, dashed = false) {
  const position = {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.max(Math.abs(x2 - x1), 1),
    height: Math.max(Math.abs(y2 - y1), 1),
  };
  return addShape(slide, "line", position, "none", {
    style: dashed ? "dashed" : "solid",
    fill: color,
    width,
  });
}

function anchor(slide, x, y) {
  return addShape(
    slide,
    "ellipse",
    { left: x - 1, top: y - 1, width: 2, height: 2 },
    "transparent",
    NO_LINE,
  );
}

function connect(slide, from, to, options = {}) {
  const {
    kind = "straight",
    fromSide = "right",
    toSide = "left",
    color = C.mutedSoft,
    width = 1.5,
    arrow = true,
    dashed = false,
    bringToFront = false,
  } = options;
  const connector = slide.shapes.connect(from, to, {
    kind,
    fromSide,
    toSide,
    line: { style: dashed ? "dashed" : "solid", fill: color, width },
    head: { type: "none" },
    tail: arrow
      ? { type: "triangle", width: "sm", length: "sm" }
      : { type: "none" },
  });
  if (bringToFront) connector.bringToFront();
  return connector;
}

function arrowBetween(slide, x1, y1, x2, y2, options = {}) {
  const from = anchor(slide, x1, y1);
  const to = anchor(slide, x2, y2);
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  const forward = horizontal ? x2 >= x1 : y2 >= y1;
  const fromSide = horizontal
    ? (forward ? "right" : "left")
    : (forward ? "bottom" : "top");
  const toSide = horizontal
    ? (forward ? "left" : "right")
    : (forward ? "top" : "bottom");
  return connect(slide, from, to, {
    ...options,
    fromSide,
    toSide,
    bringToFront: options.bringToFront ?? true,
  });
}

function addFooter(slide, number, background = C.canvas) {
  ruleH(slide, 64, 668, 1152, background === C.soft ? C.hairline : C.hairlineSoft, 1);
  addText(slide, "AirCheck", {
    left: 64,
    top: 680,
    width: 150,
    height: 18,
    size: 11,
    color: C.mutedSoft,
    bold: true,
  });
  addText(slide, `${String(number).padStart(2, "0")} / 06`, {
    left: 1110,
    top: 680,
    width: 106,
    height: 18,
    size: 11,
    color: C.mutedSoft,
    align: "right",
  });
}

function addTitle(slide, title, options = {}) {
  addText(slide, title, {
    left: options.left ?? 64,
    top: options.top ?? 46,
    width: options.width ?? 800,
    height: options.height ?? 70,
    size: options.size ?? 38,
    color: options.color ?? C.ink,
    bold: true,
    insets: { top: 0, right: 0, bottom: 2, left: 0 },
  });
}

function smallLabel(slide, text, left, top, width = 180, color = C.muted) {
  return addText(slide, text, {
    left,
    top,
    width,
    height: 18,
    size: 11,
    color,
    bold: true,
  });
}

function addSensor(slide, x, y, scale = 1) {
  addShape(
    slide,
    "ellipse",
    { left: x - 18 * scale, top: y - 18 * scale, width: 36 * scale, height: 36 * scale },
    C.canvas,
    { style: "solid", fill: C.blue, width: 1.6 },
  );
  addShape(
    slide,
    "ellipse",
    { left: x - 6 * scale, top: y - 6 * scale, width: 12 * scale, height: 12 * scale },
    C.blue,
    NO_LINE,
  );
  ruleH(slide, x - 25 * scale, y, 14 * scale, C.blue, 1);
  ruleH(slide, x + 11 * scale, y, 14 * scale, C.blue, 1);
  ruleV(slide, x, y - 25 * scale, 14 * scale, C.blue, 1);
  ruleV(slide, x, y + 11 * scale, 14 * scale, C.blue, 1);
}

function addPerson(slide, x, y, scale = 1) {
  addShape(
    slide,
    "ellipse",
    { left: x - 7 * scale, top: y - 24 * scale, width: 14 * scale, height: 14 * scale },
    C.canvas,
    { style: "solid", fill: C.ink, width: 1.2 },
  );
  line(slide, x, y - 10 * scale, x, y + 18 * scale, C.ink, 1.8);
  line(slide, x - 14 * scale, y, x + 14 * scale, y, C.ink, 1.8);
  line(slide, x, y + 18 * scale, x - 10 * scale, y + 34 * scale, C.ink, 1.8);
  line(slide, x, y + 18 * scale, x + 10 * scale, y + 34 * scale, C.ink, 1.8);
}

function drawRoom(slide, options = {}) {
  const {
    left,
    top,
    width,
    height,
    windowTop = 100,
    windowHeight = 90,
    fill = C.soft,
    wall = C.body,
  } = options;
  addShape(slide, "rect", { left, top, width, height }, fill, NO_LINE);
  ruleH(slide, left, top, width, wall, 1.6);
  ruleH(slide, left, top + height, width, wall, 1.6);
  ruleV(slide, left, top, height, wall, 1.6);
  const right = left + width;
  ruleV(slide, right, top, windowTop, wall, 1.6);
  ruleV(slide, right, top + windowTop + windowHeight, height - windowTop - windowHeight, wall, 1.6);
  ruleV(slide, right, top + windowTop, windowHeight, C.blue, 2.4);
  ruleH(slide, right - 12, top + windowTop + windowHeight / 2, 12, C.blue, 1.3);
  return { left, top, width, height, right, bottom: top + height, windowY: top + windowTop, windowHeight };
}

function setNotes(slide, text) {
  slide.speakerNotes.textFrame.setText(text);
}

const presentation = Presentation.create({ slideSize: { width: W, height: H } });

// Slide 1. Hero and system overview.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.canvas;
  smallLabel(slide, "ДИПЛОМНЫЙ ПРОЕКТ / AIRCHECK", 72, 48, 300, C.muted);
  addText(slide, "AirCheck", {
    left: 70,
    top: 88,
    width: 500,
    height: 82,
    size: 62,
    color: C.ink,
    bold: true,
  });
  addText(slide, "Мониторинг и управление\nкачеством воздуха\nв помещении", {
    left: 74,
    top: 200,
    width: 520,
    height: 138,
    size: 37,
    color: C.ink,
    bold: true,
  });
  addText(slide, "Интеллектуальная IoT-система на основе прогноза CO₂", {
    left: 76,
    top: 370,
    width: 500,
    height: 28,
    size: 18,
    color: C.body,
  });
  ruleH(slide, 76, 430, 430, C.hairline, 1);
  addText(slide, "ОДНА КОМНАТА", {
    left: 76,
    top: 456,
    width: 190,
    height: 28,
    size: 19,
    color: C.blue,
    bold: true,
  });
  addText(slide, "локальный узел, история, прогноз, действие", {
    left: 76,
    top: 493,
    width: 420,
    height: 26,
    size: 16,
    color: C.muted,
  });
  addText(slide, "Система превращает состояние помещения в проверяемый рабочий контур.", {
    left: 76,
    top: 548,
    width: 430,
    height: 44,
    size: 16,
    color: C.body,
  });

  slide.images.add({
    blob: heroRoomBytes,
    contentType: "image/png",
    alt: "Реалистичная визуализация комнаты с сенсорным узлом и потоками воздуха",
    fit: "contain",
    position: { left: 560, top: 112, width: 670, height: 430 },
  });
  smallLabel(slide, "ПОМЕЩЕНИЕ / ROOM-01", 842, 122, 220, C.muted);
  addText(slide, "CO₂ 780 ppm", {
    left: 902,
    top: 254,
    width: 132,
    height: 22,
    size: 15,
    color: C.ink,
    bold: true,
  });
  line(slide, 1030, 271, 1052, 286, C.blue, 1.1);
  addText(slide, "прогноз через 15 минут", {
    left: 902,
    top: 552,
    width: 190,
    height: 22,
    size: 14,
    color: C.blue,
    bold: true,
  });
  line(slide, 1000, 532, 1000, 548, C.blue, 1.1);
  addText(slide, "локальный контур", {
    left: 1020,
    top: 588,
    width: 160,
    height: 22,
    size: 14,
    color: C.muted,
    align: "right",
  });
  addFooter(slide, 1, C.canvas);
  setNotes(slide, "Содержание слайда основано на фактической архитектуре AirCheck: README.md, docs/ml.md и docs/ТЗ-поправка-03-climate-control.md. Значения 780 ppm и 15 минут используются как аннотации. Визуальный ассет комнаты создан специально для этой презентации и не содержит текста.");
}

// Slide 2. Spatial room diagram.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.canvas;
  addTitle(slide, "Параметры воздуха меняются в течение дня", { width: 600, height: 78, size: 35 });
  addText(slide, "Состояние комнаты зависит от условий\nвнутри и снаружи.", {
    left: 66,
    top: 178,
    width: 400,
    height: 72,
    size: 27,
    color: C.ink,
    bold: true,
  });
  addText(slide, "CO₂ и PM2.5 могут расти постепенно.\nБез измерений изменение легко пропустить.", {
    left: 68,
    top: 300,
    width: 390,
    height: 56,
    size: 17,
    color: C.body,
  });
  smallLabel(slide, "ОДНА КОМНАТА", 68, 404, 170, C.blue);
  addText(slide, "Внутри находятся люди и датчики.\nОкно и вентиляция связывают комнату\nс внешней средой.", {
    left: 68,
    top: 432,
    width: 400,
    height: 76,
    size: 16,
    color: C.muted,
  });

  slide.images.add({
    blob: roomContextBytes,
    contentType: "image/png",
    alt: "Реалистичная пространственная сцена комнаты с людьми, окном, вентиляцией и сенсором",
    fit: "contain",
    position: { left: 535, top: 142, width: 700, height: 400 },
  });
  smallLabel(slide, "ПОМЕЩЕНИЕ / ROOM-01", 638, 154, 220, C.muted);
  smallLabel(slide, "ВЫТЯЖКА", 572, 192, 96, C.muted);
  smallLabel(slide, "ПРИТОК", 572, 498, 96, C.muted);
  addText(slide, "ОКНО / НАРУЖНАЯ СРЕДА", {
    left: 1012,
    top: 526,
    width: 220,
    height: 20,
    size: 12,
    color: C.blue,
    bold: true,
    align: "right",
  });
  addText(slide, "CO₂ / PM2.5", {
    left: 908,
    top: 548,
    width: 120,
    height: 20,
    size: 13,
    color: C.body,
    bold: true,
    align: "right",
  });
  ruleH(slide, 66, 596, 1148, C.hairline, 1);
  smallLabel(slide, "НОРМАТИВНАЯ РАМКА", 66, 620, 190, C.muted);
  addText(slide, "СанПиН 1.2.3685-21, СП 60.13330.2020 и ASHRAE связывают качество воздуха с микроклиматом и вентиляцией.", {
    left: 276,
    top: 617,
    width: 870,
    height: 26,
    size: 14,
    color: C.body,
  });
  addFooter(slide, 2, C.canvas);
  setNotes(slide, "Источники: https://www.epa.gov/indoor-air-quality-iaq/indoor-pollutants-and-sources ; https://www.ashrae.org/technical-resources/bookstore/standards-62-1-62-2 ; https://www.consultant.ru/document/cons_doc_LAW_375839/ ; https://protect.gost.ru/sp/details/b00f766e-b861-4cc7-a448-c65906490262 . Визуальный ассет комнаты создан специально для этой презентации и не содержит текста.");
}

// Slide 3. Temporal comparison.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.canvas;
  addTitle(slide, "Текущего значения недостаточно", { width: 660, size: 39 });
  addText(slide, "Прогноз сдвигает\nрешение раньше", {
    left: 816,
    top: 54,
    width: 350,
    height: 66,
    size: 28,
    color: C.blue,
    bold: true,
  });
  smallLabel(slide, "ТЕКУЩИЙ СЦЕНАРИЙ", 82, 166, 220, C.muted);
  addText(slide, "действие после изменения", {
    left: 82,
    top: 190,
    width: 260,
    height: 22,
    size: 16,
    color: C.body,
  });
  ruleH(slide, 180, 298, 940, C.mutedSoft, 2);
  const currentPoints = [190, 450, 670, 1000];
  currentPoints.forEach((x, index) => {
    addShape(slide, "ellipse", { left: x - 7, top: 291, width: 14, height: 14 }, C.canvas, {
      style: "solid",
      fill: C.body,
      width: 2,
    });
    ruleV(slide, x, 298, 18, C.hairline, 1);
    const labels = ["текущее\nзначение", "рост CO₂", "человек\nзамечает", "вентиляция"];
    addText(slide, labels[index], {
      left: x - 70,
      top: 244,
      width: 140,
      height: 38,
      size: 14,
      color: C.body,
      bold: index === 3,
      align: "center",
    });
  });
  line(slide, 450, 316, 450, 348, C.mutedSoft, 1, true);
  line(slide, 1000, 316, 1000, 348, C.mutedSoft, 1, true);
  ruleH(slide, 450, 348, 550, C.mutedSoft, 1);
  addText(slide, "реакция начинается после изменения", {
    left: 600,
    top: 356,
    width: 250,
    height: 20,
    size: 14,
    color: C.muted,
    align: "center",
  });

  smallLabel(slide, "ЦЕЛЕВОЙ СЦЕНАРИЙ", 82, 410, 220, C.blue);
  addText(slide, "прогноз добавляет момент для решения", {
    left: 82,
    top: 434,
    width: 340,
    height: 22,
    size: 16,
    color: C.body,
  });
  ruleH(slide, 180, 500, 940, C.blue, 2.2);
  const targetPoints = [190, 410, 620, 800, 1040];
  const targetLabels = ["показания", "прогноз\n15 минут", "рекомендация", "команда", "подтверждение"];
  targetPoints.forEach((x, index) => {
    addShape(slide, "ellipse", { left: x - 8, top: 492, width: 16, height: 16 }, C.canvas, {
      style: "solid",
      fill: C.blue,
      width: 2,
    });
    ruleV(slide, x, 500, 18, C.blueSoft, 1);
    addText(slide, targetLabels[index], {
      left: x - 70,
      top: 535,
      width: 140,
      height: 38,
      size: 14,
      color: index === 1 || index === 3 ? C.blue : C.body,
      bold: index === 1 || index === 3,
      align: "center",
    });
  });
  line(slide, 920, 450, 920, 535, C.blue, 1, true);
  addText(slide, "критический рост", {
    left: 858,
    top: 426,
    width: 124,
    height: 18,
    size: 12,
    color: C.blue,
    align: "center",
  });
  addText(slide, "Решение появляется до критического роста и остаётся проверяемым.", {
    left: 690,
    top: 570,
    width: 500,
    height: 36,
    size: 15.5,
    color: C.blue,
    bold: true,
    align: "right",
  });
  ruleH(slide, 64, 614, 1152, C.hairline, 1);
  smallLabel(slide, "ПРАКТИЧЕСКАЯ ЗАДАЧА", 64, 632, 200, C.muted);
  addText(slide, "Связать измерение, прогноз, рекомендацию и управление в одном локальном контуре.", {
    left: 284,
    top: 630,
    width: 810,
    height: 24,
    size: 15,
    color: C.ink,
    bold: true,
  });
  addFooter(slide, 3, C.canvas);
  setNotes(slide, "Логика сравнения основана на описании проблемы и ограничений AirCheck в docs/актуальность-темы.md. Научный контекст по кратковременному воздействию CO₂: https://www.sciencedirect.com/science/article/pii/S036013232300358X . Практические ограничения воздухообмена: https://www.epa.gov/indoor-air-quality-iaq/improving-indoor-air-quality .");
}

// Slide 4. Capability matrix.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.soft;
  addTitle(slide, "Аналоги закрывают отдельные части задачи", { width: 1000, size: 36 });
  addText(slide, "AirCheck объединяет всю цепочку", {
    left: 64,
    top: 116,
    width: 470,
    height: 30,
    size: 25,
    color: C.blue,
    bold: true,
  });
  addText(slide, "Матрица показывает заявленные возможности в масштабе одной комнаты", {
    left: 64,
    top: 151,
    width: 620,
    height: 22,
    size: 15,
    color: C.muted,
  });

  const matrixLeft = 64;
  const columnWidths = [270, 170, 100, 105, 135, 135, 88, 149];
  const columnLefts = [];
  let columnCursor = matrixLeft;
  for (const width of columnWidths) {
    columnLefts.push(columnCursor);
    columnCursor += width;
  }
  const values = [
    ["Aranet4 HOME", "CO₂, T, RH", "+", "−", "±", "−", "−", "±"],
    ["Airthings View Plus", "CO₂, PM2.5, T/RH", "+", "−", "±", "−", "−", "±"],
    ["Sanobreeze", "CO₂", "−", "−", "−", "+", "−", "+"],
    ["AirGradient ONE / Open Air +\nHome Assistant", "CO₂, PM2.5, T/RH", "+", "−", "±", "+", "±", "+"],
    ["AirCheck", "CO₂, PM2.5, T/RH", "+", "+", "+", "+", "+", "+"],
  ];
  const matrixTop = 184;
  const headerRule = 210;
  const featureRule = 244;
  const dataTop = 252;
  const rowHeight = 51;
  ruleH(slide, matrixLeft, matrixTop - 4, 1152, C.muted, 1);
  smallLabel(slide, "РЕШЕНИЕ", columnLefts[0] + 8, matrixTop, columnWidths[0] - 16, C.muted);
  smallLabel(slide, "ИЗМЕРЕНИЕ", columnLefts[1] + 8, matrixTop, columnWidths[1] + columnWidths[2] - 16, C.muted);
  smallLabel(slide, "ИНТЕЛЛЕКТ", columnLefts[3] + 8, matrixTop, columnWidths[3] + columnWidths[4] - 16, C.muted);
  smallLabel(slide, "ДЕЙСТВИЕ", columnLefts[5] + 8, matrixTop, columnWidths[5] + columnWidths[6] - 16, C.muted);
  smallLabel(slide, "ЛОКАЛЬНОСТЬ", columnLefts[7] + 8, matrixTop, columnWidths[7] - 16, C.muted);
  ruleH(slide, matrixLeft, headerRule, 1152, C.hairline, 1);
  const featureHeaders = ["", "Датчики", "История", "Прогноз", "Рекомендация", "Вентиляция", "Окно", "Локально"];
  for (let col = 0; col < featureHeaders.length; col += 1) {
    addText(slide, featureHeaders[col], {
      left: columnLefts[col] + 8,
      top: 218,
      width: columnWidths[col] - 16,
      height: 20,
      size: 12,
      color: C.ink,
      bold: true,
      align: col >= 2 ? "center" : "left",
      valign: "middle",
    });
  }
  ruleH(slide, matrixLeft, featureRule, 1152, C.hairline, 1);
  ruleV(slide, columnLefts[3], matrixTop - 4, dataTop + rowHeight * values.length - matrixTop + 4, C.hairlineSoft, 1);
  ruleV(slide, columnLefts[5], matrixTop - 4, dataTop + rowHeight * values.length - matrixTop + 4, C.hairlineSoft, 1);
  ruleV(slide, columnLefts[7], matrixTop - 4, dataTop + rowHeight * values.length - matrixTop + 4, C.hairlineSoft, 1);
  for (let row = 0; row < values.length; row += 1) {
    const rowTop = dataTop + row * rowHeight;
    const isAirCheck = row === values.length - 1;
    if (row > 0) ruleH(slide, matrixLeft, rowTop, 1152, C.hairline, 1);
    for (let col = 0; col < values[row].length; col += 1) {
      const isSign = col >= 2;
      addText(slide, values[row][col], {
        left: columnLefts[col] + 8,
        top: rowTop + (values[row][col].includes("\n") ? 7 : 13),
        width: columnWidths[col] - 16,
        height: values[row][col].includes("\n") ? 36 : 24,
        size: isSign ? 16 : 13.5,
        color: isSign && isAirCheck ? C.blue : isSign && values[row][col] === "−" ? C.muted : C.body,
        bold: isAirCheck || isSign,
        align: isSign ? "center" : "left",
        valign: "middle",
      });
    }
  }
  ruleH(slide, matrixLeft, dataTop + rowHeight * values.length, 1152, C.muted, 1);
  ruleV(slide, matrixLeft, dataTop + rowHeight * (values.length - 1), rowHeight, C.blue, 3);
  addText(slide, "+ заявлено или реализовано", {
    left: 66,
    top: 558,
    width: 220,
    height: 18,
    size: 12,
    color: C.muted,
  });
  addText(slide, "− не заявлено", {
    left: 330,
    top: 558,
    width: 150,
    height: 18,
    size: 12,
    color: C.muted,
  });
  addText(slide, "± частичная поддержка или настройка", {
    left: 520,
    top: 558,
    width: 290,
    height: 18,
    size: 12,
    color: C.muted,
  });
  addText(slide, "Сравнение по официальным описаниям решений", {
    left: 900,
    top: 558,
    width: 280,
    height: 18,
    size: 12,
    color: C.mutedSoft,
    align: "right",
  });
  addFooter(slide, 4, C.soft);
  setNotes(slide, "Источники аналогов: https://help.aranet.com/aranet4/aranet4-home/general/what-does-the-aranet4-do ; https://www.airthings.com/en/view-plus ; https://www.rylosystems.com/en_US/products/sanobreeze-co2-vent-controller ; https://www.airgradient.com/home-assistant/ ; https://www.home-assistant.io/docs/automation . Знак минус показывает отсутствие заявленной функции в выбранных материалах, а не невозможность интеграции.");
}

// Slide 5. Technical signal path.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.canvas;
  addTitle(slide, "AirCheck связывает измерение с действием", { width: 880, size: 38 });
  smallLabel(slide, "СИГНАЛЬНЫЙ ПУТЬ ПРОГРАММНОГО ПРОТОТИПА", 930, 62, 270, C.muted);
  const xs = [170, 390, 610, 830, 1050];
  const stageLabel = (text, x, color) => addText(slide, text, {
    left: x - 90,
    top: 218,
    width: 180,
    height: 18,
    size: 11,
    color,
    bold: true,
    align: "center",
  });
  const stageTitle = (text, x) => addText(slide, text, {
    left: x - 80,
    top: 312,
    width: 160,
    height: 24,
    size: 20,
    color: C.ink,
    bold: true,
    align: "center",
  });
  const stageSubtitle = (text, x) => addText(slide, text, {
    left: x - 90,
    top: 348,
    width: 180,
    height: 20,
    size: 14,
    color: C.muted,
    align: "center",
  });

  ruleH(slide, 138, 270, 912, C.hairline, 1);
  arrowBetween(slide, xs[0] + 26, 270, xs[1] - 24, 270, { color: C.mutedSoft, width: 1.5 });
  arrowBetween(slide, xs[1] + 27, 270, xs[2] - 27, 270, { color: C.mutedSoft, width: 1.5 });
  arrowBetween(slide, xs[2] + 28, 270, xs[3] - 28, 270, { color: C.blue, width: 2.2 });
  arrowBetween(slide, xs[3] + 28, 270, xs[4] - 28, 270, { color: C.blue, width: 2.2 });

  stageLabel("01 / ИСТОЧНИК", xs[0], C.muted);
  addSensor(slide, xs[0], 270, 0.9);
  addShape(slide, "ellipse", { left: xs[0] - 21, top: 238, width: 10, height: 10 }, C.blue, NO_LINE);
  addShape(slide, "ellipse", { left: xs[0] - 5, top: 238, width: 10, height: 10 }, C.ink, NO_LINE);
  addShape(slide, "ellipse", { left: xs[0] + 11, top: 238, width: 10, height: 10 }, C.mutedSoft, NO_LINE);
  stageTitle("датчики", xs[0]);
  stageSubtitle("внутри и снаружи", xs[0]);

  stageLabel("02 / ХРАНЕНИЕ", xs[1], C.muted);
  ruleV(slide, xs[1] - 20, 248, 44, C.body, 1.4);
  ruleV(slide, xs[1] + 20, 248, 44, C.body, 1.4);
  ruleH(slide, xs[1] - 20, 248, 40, C.body, 1.4);
  ruleH(slide, xs[1] - 20, 270, 40, C.body, 1.2);
  ruleH(slide, xs[1] - 20, 292, 40, C.body, 1.4);
  stageTitle("история", xs[1]);
  stageSubtitle("PostgreSQL", xs[1]);

  stageLabel("03 / АНАЛИЗ", xs[2], C.blue);
  addShape(slide, "ellipse", { left: xs[2] - 30, top: 240, width: 60, height: 60 }, C.blueSoft, { style: "solid", fill: C.blue, width: 2 });
  addText(slide, "15 мин", { left: xs[2] - 28, top: 258, width: 56, height: 20, size: 15, color: C.blue, bold: true, align: "center", valign: "middle" });
  stageTitle("прогноз", xs[2]);
  stageSubtitle("CO₂ / 15 минут", xs[2]);

  stageLabel("04 / РЕШЕНИЕ", xs[3], C.blue);
  addShape(slide, "diamond", { left: xs[3] - 29, top: 241, width: 58, height: 58 }, C.canvas, { style: "solid", fill: C.blue, width: 2 });
  stageTitle("решение", xs[3]);
  stageSubtitle("рекомендация", xs[3]);

  stageLabel("05 / ИСПОЛНЕНИЕ", xs[4], C.blue);
  addShape(slide, "ellipse", { left: xs[4] - 10, top: 260, width: 20, height: 20 }, C.blue, NO_LINE);
  stageTitle("команды", xs[4]);
  line(slide, xs[4] + 10, 270, 1110, 270, C.blue, 1.6);
  ruleV(slide, 1110, 270, 110, C.blue, 1.8);
  arrowBetween(slide, 1110, 300, 1178, 300, { color: C.blue, width: 1.6 });
  arrowBetween(slide, 1110, 340, 1178, 340, { color: C.blue, width: 1.4 });
  arrowBetween(slide, 1110, 380, 1178, 380, { color: C.blue, width: 1.4 });
  addText(slide, "вытяжка", { left: 1184, top: 292, width: 64, height: 18, size: 13, color: C.body });
  addText(slide, "приток", { left: 1184, top: 332, width: 64, height: 18, size: 13, color: C.body });
  addText(slide, "окно", { left: 1184, top: 372, width: 64, height: 18, size: 13, color: C.body });

  ruleH(slide, 64, 420, 1152, C.hairline, 1);
  ruleV(slide, xs[3], 372, 48, C.blue, 1);
  ruleV(slide, xs[4], 372, 48, C.hairline, 1);
  ruleV(slide, 1178, 380, 40, C.hairline, 1);

  smallLabel(slide, "РУЧНОЕ УПРАВЛЕНИЕ", 610, 438, 190, C.blue);
  addText(slide, "Команда оператора сохраняется до следующего решения.", {
    left: 610,
    top: 464,
    width: 190,
    height: 56,
    size: 15,
    color: C.body,
  });
  smallLabel(slide, "DESIRED / REPORTED", 830, 438, 190, C.muted);
  addText(slide, "Состояние считается изменённым только после подтверждения узла.", {
    left: 830,
    top: 464,
    width: 190,
    height: 60,
    size: 15,
    color: C.body,
  });
  smallLabel(slide, "ONLINE / STALE / OFFLINE", 1048, 438, 166, C.muted);
  addText(slide, "Ожидающая команда остаётся в очереди.", {
    left: 1048,
    top: 464,
    width: 166,
    height: 56,
    size: 15,
    color: C.body,
  });
  addFooter(slide, 5, C.canvas);
  setNotes(slide, "Фактическая архитектура и состояния подтверждения: README.md, docs/ml.md и docs/ТЗ-поправка-03-climate-control.md. В проекте различаются desired и reported состояния, очередь команд и статусы online, stale, offline.");
}

// Slide 6. Scope map.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.soft;
  addTitle(slide, "Цель и границы проекта", { width: 600, size: 36 });
  smallLabel(slide, "ОБЪЁМ ПРОВЕРКИ", 690, 126, 180, C.muted);
  addText(slide, "Проверить локальный\nсценарий\nдля одной комнаты", {
    left: 66,
    top: 164,
    width: 520,
    height: 142,
    size: 45,
    color: C.ink,
    bold: true,
  });
  addText(slide, "Система по данным датчиков оценивает состояние воздуха, прогнозирует изменение CO₂ и поддерживает ручное или автоматическое управление проветриванием.", {
    left: 68,
    top: 348,
    width: 480,
    height: 72,
    size: 18,
    color: C.body,
  });
  ruleV(slide, 626, 152, 386, C.hairline, 1);

  const scopeLeft = 690;
  const scopeWidth = 500;
  smallLabel(slide, "01  УЖЕ РЕАЛИЗОВАНО", scopeLeft, 166, scopeWidth, C.muted);
  addText(slide, "панель, REST-контракт, PostgreSQL, прогноз, рекомендации, очередь команд", {
    left: scopeLeft,
    top: 198,
    width: scopeWidth,
    height: 42,
    size: 17,
    color: C.ink,
  });
  ruleH(slide, scopeLeft, 262, scopeWidth, C.hairline, 1);

  smallLabel(slide, "02  ПРОВЕРЯЕТСЯ В ДИПЛОМНОЙ РАБОТЕ", scopeLeft, 286, scopeWidth, C.blue);
  addText(slide, "рост CO₂, ручное управление окном, автоматическое проветривание, подтверждение состояния", {
    left: scopeLeft,
    top: 318,
    width: scopeWidth,
    height: 46,
    size: 17,
    color: C.ink,
  });
  ruleH(slide, scopeLeft, 386, scopeWidth, C.hairline, 1);

  smallLabel(slide, "03  ВНЕ ТЕКУЩЕГО ЭТАПА", scopeLeft, 410, scopeWidth, C.muted);
  addText(slide, "физическая ESP32, реальные датчики, фильтр, моторы, механизм окна", {
    left: scopeLeft,
    top: 442,
    width: scopeWidth,
    height: 42,
    size: 17,
    color: C.body,
  });
  addText(slide, "программный прототип", {
    left: 690,
    top: 516,
    width: 190,
    height: 20,
    size: 14,
    color: C.blue,
    bold: true,
  });
  ruleH(slide, 890, 525, 128, C.blue, 2);
  addText(slide, "физическое подключение", {
    left: 1034,
    top: 516,
    width: 156,
    height: 20,
    size: 14,
    color: C.muted,
    align: "right",
  });

  ruleH(slide, 66, 574, 110, C.blue, 3);
  addText(slide, "Связать данные датчиков, прогноз и подтверждённое действие в одном локальном контуре.", {
    left: 66,
    top: 596,
    width: 1100,
    height: 34,
    size: 24,
    color: C.ink,
    bold: true,
  });
  addFooter(slide, 6, C.soft);
  setNotes(slide, "Границы проекта сверены с README.md, docs/актуальность-темы.md и docs/ТЗ-поправка-03-climate-control.md. Физическая ESP32, реальные датчики, фильтр, моторы и механизм окна на текущем этапе не подключены; simulator использует предусмотренный REST-контракт.");
}

await (await PresentationFile.exportPptx(presentation)).save(candidatePath);

for (let i = 0; i < presentation.slides.items.length; i += 1) {
  const slide = presentation.slides.items[i];
  const preview = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(
    path.join(buildDir, `redesign-draft-slide-${i + 1}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(
    path.join(buildDir, `redesign-draft-slide-${i + 1}.layout.json`),
    await layout.text(),
  );
}

console.log(JSON.stringify({
  candidatePath,
  slideCount: presentation.slides.items.length,
  font: FONT,
}, null, 2));
