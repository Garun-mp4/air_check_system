import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";
import { pathToFileURL } from "node:url";

const workspaceDir = "C:\\Users\\admin\\Desktop\\ВКР";
const buildDir = path.join(workspaceDir, ".codex-pptx-build");
const candidatePath = path.join(buildDir, "aircheck-aktualnost-draft.pptx");
const skillDir = "C:\\Users\\admin\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.905.11957\\skills\\presentations";

await fs.mkdir(buildDir, { recursive: true });

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
  strong: "#E5E7EB",
  hairline: "#E5E7EB",
  hairlineSoft: "#F3F4F6",
  dark: "#101010",
  darkElevated: "#1A1A1A",
  ink: "#111111",
  body: "#374151",
  muted: "#6B7280",
  mutedSoft: "#898989",
  white: "#FFFFFF",
  success: "#10B981",
  successSoft: "#ECFDF5",
  warning: "#F59E0B",
  warningSoft: "#FFFBEB",
  error: "#EF4444",
  errorSoft: "#FEF2F2",
  blue: "#3B82F6",
  blueSoft: "#EFF6FF",
  orange: "#FB923C",
};

const NO_LINE = { style: "solid", fill: "none", width: 0 };
const HAIRLINE = { style: "solid", fill: C.hairline, width: 1 };

function addShape(slide, geometry, position, fill = "none", line = NO_LINE, borderRadius) {
  const config = { geometry, position, fill, line };
  if (borderRadius !== undefined) config.borderRadius = borderRadius;
  return slide.shapes.add(config);
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

function addPanel(slide, position, options = {}) {
  const {
    fill = C.card,
    line = HAIRLINE,
    radius = 12,
    shadow,
  } = options;
  const panel = addShape(slide, "roundRect", position, fill, line, radius);
  if (shadow) panel.shadow = shadow;
  return panel;
}

function addPill(slide, text, position, options = {}) {
  const {
    fill = C.card,
    color = C.ink,
    line = NO_LINE,
    size = 13,
    bold = true,
  } = options;
  addPanel(slide, position, { fill, line, radius: 9999 });
  addText(slide, text, {
    left: position.left,
    top: position.top + 1,
    width: position.width,
    height: position.height - 2,
    size,
    color,
    bold,
    align: "center",
    valign: "middle",
  });
}

function addRule(slide, left, top, width, color = C.hairline) {
  return addShape(
    slide,
    "rect",
    { left, top, width, height: 1 },
    color,
    NO_LINE,
  );
}

function addFooter(slide, number, dark = false) {
  const color = dark ? "#A1A1AA" : C.mutedSoft;
  addText(slide, "AirCheck", {
    left: 64,
    top: 682,
    width: 120,
    height: 18,
    size: 12,
    color,
    bold: true,
  });
  addText(slide, String(number).padStart(2, "0") + " / 06", {
    left: 1110,
    top: 682,
    width: 106,
    height: 18,
    size: 12,
    color,
    align: "right",
  });
}

function addTitle(slide, title, subtitle) {
  addText(slide, title, {
    left: 64,
    top: 44,
    width: 1000,
    height: 56,
    size: 39,
    color: C.ink,
    bold: true,
    insets: { top: 0, right: 0, bottom: 2, left: 0 },
  });
  if (subtitle) {
    addText(slide, subtitle, {
      left: 66,
      top: 104,
      width: 1040,
      height: 30,
      size: 16,
      color: C.muted,
    });
  }
}

function addNode(slide, text, position, options = {}) {
  const {
    fill = C.canvas,
    line = HAIRLINE,
    titleColor = C.ink,
    size = 18,
    radius = 12,
  } = options;
  addPanel(slide, position, { fill, line, radius });
  addText(slide, text, {
    left: position.left + 14,
    top: position.top + 10,
    width: position.width - 28,
    height: position.height - 20,
    size,
    color: titleColor,
    bold: true,
    align: "center",
    valign: "middle",
  });
  return slide.shapes.items[slide.shapes.items.length - 1];
}

function connect(slide, from, to, options = {}) {
  return slide.shapes.connect(from, to, {
    kind: options.kind ?? "straight",
    fromSide: options.fromSide ?? "right",
    toSide: options.toSide ?? "left",
    line: {
      style: options.dashed ? "dashed" : "solid",
      fill: options.color ?? C.mutedSoft,
      width: options.width ?? 2,
    },
    head: { type: "none" },
    tail: options.head === false
      ? { type: "none" }
      : { type: "triangle", width: "sm", length: "sm" },
  });
}

function addMetric(slide, label, value, note, position, accent) {
  addText(slide, label, {
    left: position.left,
    top: position.top,
    width: position.width,
    height: 20,
    size: 13,
    color: C.muted,
    bold: true,
  });
  addText(slide, value, {
    left: position.left,
    top: position.top + 21,
    width: position.width,
    height: 48,
    size: 35,
    color: C.ink,
    bold: true,
  });
  addText(slide, note, {
    left: position.left,
    top: position.top + 72,
    width: position.width,
    height: 22,
    size: 13,
    color: accent ?? C.muted,
  });
}

const presentation = Presentation.create({
  slideSize: { width: W, height: H },
});

// Slide 1. Cover.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.canvas;

  addText(slide, "Актуальность темы дипломной работы", {
    left: 72,
    top: 48,
    width: 420,
    height: 20,
    size: 13,
    color: C.muted,
    bold: true,
  });
  addText(slide, "AirCheck", {
    left: 72,
    top: 96,
    width: 560,
    height: 76,
    size: 64,
    color: C.ink,
    bold: true,
  });
  addText(slide, "Мониторинг и управление\nкачеством воздуха в помещении", {
    left: 76,
    top: 192,
    width: 570,
    height: 122,
    size: 35,
    color: C.ink,
    bold: true,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  addText(slide, "Интеллектуальная IoT-система на основе прогноза CO₂", {
    left: 76,
    top: 340,
    width: 510,
    height: 32,
    size: 18,
    color: C.body,
  });
  addRule(slide, 76, 410, 488, C.hairline);
  addText(slide, "Одна комната. Данные датчиков. Решение о проветривании.", {
    left: 76,
    top: 430,
    width: 520,
    height: 28,
    size: 16,
    color: C.muted,
  });
  addText(slide, "Дипломная работа", {
    left: 76,
    top: 634,
    width: 210,
    height: 20,
    size: 13,
    color: C.mutedSoft,
  });

  const mockup = addPanel(slide, { left: 726, top: 92, width: 456, height: 520 }, {
    fill: C.card,
    line: HAIRLINE,
    radius: 16,
  });
  addText(slide, "Состояние комнаты", {
    left: 762,
    top: 128,
    width: 260,
    height: 28,
    size: 18,
    color: C.ink,
    bold: true,
  });
  addText(slide, "локальный узел room-01", {
    left: 762,
    top: 158,
    width: 230,
    height: 20,
    size: 13,
    color: C.muted,
  });
  addPill(slide, "online", { left: 1066, top: 128, width: 78, height: 28 }, {
    fill: C.successSoft,
    color: "#047857",
    line: { style: "solid", fill: "#A7F3D0", width: 1 },
    size: 12,
  });
  addRule(slide, 762, 204, 384);
  addMetric(slide, "CO₂ сейчас", "780", "ppm, в пределах нормы", { left: 762, top: 228, width: 180 }, C.success);
  addMetric(slide, "Прогноз", "15", "минут до следующей оценки", { left: 1000, top: 228, width: 150 }, C.blue);
  addRule(slide, 762, 342, 384);
  addText(slide, "Климатический контур", {
    left: 762,
    top: 366,
    width: 250,
    height: 22,
    size: 13,
    color: C.muted,
    bold: true,
  });
  const states = [
    ["Вытяжка", "выкл."],
    ["Приток", "выкл."],
    ["Окно", "закрыто"],
  ];
  states.forEach((item, index) => {
    const y = 402 + index * 45;
    addText(slide, item[0], {
      left: 762,
      top: y,
      width: 132,
      height: 24,
      size: 16,
      color: C.body,
    });
    addText(slide, item[1], {
      left: 1044,
      top: y,
      width: 102,
      height: 24,
      size: 16,
      color: C.muted,
      align: "right",
    });
    addRule(slide, 762, y + 31, 384, C.hairlineSoft);
  });
  addText(slide, "прогноз, рекомендация, команда", {
    left: 762,
    top: 560,
    width: 350,
    height: 22,
    size: 13,
    color: C.mutedSoft,
  });
  mockup.sendToBack();
  addFooter(slide, 1);
  slide.speakerNotes.textFrame.setText(
    "Содержание основано на README AirCheck и документах проекта. Физические датчики и ESP32 пока не подключены. Визуальный блок на слайде является редактируемой схемой интерфейса, а не показанием реального устройства.",
  );
}

// Slide 2. Context.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.soft;
  addTitle(slide, "Параметры воздуха меняются в течение дня", "Контекст задачи: одна комната с локальным IoT-узлом");

  addText(slide, "На состояние воздуха влияют\nусловия внутри комнаты\nи за окном.", {
    left: 66,
    top: 194,
    width: 360,
    height: 125,
    size: 30,
    color: C.ink,
    bold: true,
  });
  addText(slide, "Без измерений рост CO₂ и PM2.5\nможет оставаться незаметным.", {
    left: 68,
    top: 350,
    width: 340,
    height: 56,
    size: 18,
    color: C.body,
  });

  const center = addShape(slide, "ellipse", { left: 760, top: 254, width: 230, height: 146 }, C.canvas, HAIRLINE);
  addText(slide, "состояние\nвоздуха", {
    left: 784,
    top: 284,
    width: 182,
    height: 75,
    size: 22,
    color: C.ink,
    bold: true,
    align: "center",
    valign: "middle",
  });

  const factors = [
    { label: "Люди", left: 510, top: 164, fill: C.warningSoft, color: "#92400E" },
    { label: "Вентиляция", left: 1028, top: 164, fill: C.blueSoft, color: "#1D4ED8" },
    { label: "Окно", left: 510, top: 462, fill: C.successSoft, color: "#047857" },
    { label: "Внешняя среда", left: 1028, top: 462, fill: C.card, color: C.body },
  ];
  const factorShapes = factors.map((factor) => {
    const shape = addPanel(slide, { left: factor.left, top: factor.top, width: 190, height: 62 }, {
      fill: factor.fill,
      line: HAIRLINE,
      radius: 12,
    });
    addText(slide, factor.label, {
      left: factor.left + 12,
      top: factor.top + 10,
      width: 166,
      height: 40,
      size: 18,
      color: factor.color,
      bold: true,
      align: "center",
      valign: "middle",
    });
    return shape;
  });
  connect(slide, factorShapes[0], center, { fromSide: "right", toSide: "top", kind: "elbow", color: C.mutedSoft });
  connect(slide, factorShapes[1], center, { fromSide: "left", toSide: "top", kind: "elbow", color: C.mutedSoft });
  connect(slide, factorShapes[2], center, { fromSide: "right", toSide: "bottom", kind: "elbow", color: C.mutedSoft });
  connect(slide, factorShapes[3], center, { fromSide: "left", toSide: "bottom", kind: "elbow", color: C.mutedSoft });

  addRule(slide, 66, 544, 1110);
  addText(slide, "Нормативная рамка", {
    left: 66,
    top: 570,
    width: 190,
    height: 20,
    size: 13,
    color: C.muted,
    bold: true,
  });
  addText(slide, "СанПиН 1.2.3685-21 и СП 60.13330.2020 задают требования к микроклимату, вентиляции и качеству воздуха в зданиях.", {
    left: 260,
    top: 567,
    width: 620,
    height: 34,
    size: 15,
    color: C.body,
  });
  addText(slide, "EPA и ASHRAE связывают качество воздуха с источниками загрязнения, воздухообменом и эксплуатацией вентиляции.", {
    left: 900,
    top: 567,
    width: 280,
    height: 42,
    size: 13,
    color: C.muted,
    align: "right",
  });
  addFooter(slide, 2);
  slide.speakerNotes.textFrame.setText(
    "Источники: https://www.epa.gov/indoor-air-quality-iaq/indoor-pollutants-and-sources ; https://www.ashrae.org/technical-resources/bookstore/standards-62-1-62-2 ; https://www.consultant.ru/document/cons_doc_LAW_375839/ ; https://protect.gost.ru/sp/details/b00f766e-b861-4cc7-a448-c65906490262 .",
  );
}

// Slide 3. Problem.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.canvas;
  addTitle(slide, "Текущего значения недостаточно", "Решение о проветривании зависит от того, видит ли система динамику");

  addText(slide, "Текущий сценарий", {
    left: 84,
    top: 168,
    width: 360,
    height: 26,
    size: 18,
    color: C.muted,
    bold: true,
  });
  addText(slide, "Человек реагирует после роста показателя.", {
    left: 84,
    top: 200,
    width: 400,
    height: 30,
    size: 22,
    color: C.ink,
    bold: true,
  });
  const currentNodes = [];
  [
    ["Текущее значение", C.card],
    ["Человек замечает рост", C.canvas],
    ["Ручное решение", C.card],
    ["Включение", C.warningSoft],
  ].forEach((item, index) => {
    const left = 84 + index * 158;
    const node = addPanel(slide, { left, top: 292, width: 132, height: 78 }, {
      fill: item[1],
      line: HAIRLINE,
      radius: 12,
    });
    addText(slide, item[0], {
      left: left + 10,
      top: 307,
      width: 112,
      height: 48,
      size: 15,
      color: C.body,
      bold: true,
      align: "center",
      valign: "middle",
    });
    currentNodes.push(node);
  });
  for (let i = 0; i < currentNodes.length - 1; i += 1) {
    connect(slide, currentNodes[i], currentNodes[i + 1], {
      color: C.mutedSoft,
      width: 1.5,
    });
  }
  addText(slide, "Реакция начинается после изменения.", {
    left: 84,
    top: 402,
    width: 380,
    height: 24,
    size: 15,
    color: "#B45309",
  });

  addText(slide, "Целевой сценарий", {
    left: 700,
    top: 168,
    width: 360,
    height: 26,
    size: 18,
    color: C.muted,
    bold: true,
  });
  addText(slide, "Система учитывает динамику и подтверждает результат.", {
    left: 700,
    top: 200,
    width: 490,
    height: 56,
    size: 22,
    color: C.ink,
    bold: true,
  });
  const targetNodes = [];
  [
    ["Показания", C.card],
    ["Прогноз\n15 минут", C.blueSoft],
    ["Рекомендация", C.successSoft],
    ["Команда", C.card],
    ["Подтверждение", C.successSoft],
  ].forEach((item, index) => {
    const left = 700 + index * 114;
    const node = addPanel(slide, { left, top: 292, width: 98, height: 92 }, {
      fill: item[1],
      line: HAIRLINE,
      radius: 12,
    });
    addText(slide, item[0], {
      left: left + 8,
      top: 308,
      width: 82,
      height: 58,
      size: 14,
      color: C.body,
      bold: true,
      align: "center",
      valign: "middle",
    });
    targetNodes.push(node);
  });
  for (let i = 0; i < targetNodes.length - 1; i += 1) {
    connect(slide, targetNodes[i], targetNodes[i + 1], {
      color: C.success,
      width: 1.8,
    });
  }
  addText(slide, "Решение появляется до критического роста и остаётся проверяемым.", {
    left: 700,
    top: 416,
    width: 480,
    height: 24,
    size: 15,
    color: "#047857",
  });

  addRule(slide, 64, 520, 1110);
  addText(slide, "Практическая задача", {
    left: 64,
    top: 550,
    width: 190,
    height: 20,
    size: 13,
    color: C.muted,
    bold: true,
  });
  addText(slide, "Связать измерение, прогноз, рекомендацию и управление в одном локальном контуре для одной комнаты.", {
    left: 280,
    top: 544,
    width: 780,
    height: 36,
    size: 20,
    color: C.ink,
    bold: true,
  });
  addFooter(slide, 3);
  slide.speakerNotes.textFrame.setText(
    "Содержание основано на проблемной формулировке из docs/актуальность-темы.md и на требованиях проекта к прогнозу CO₂, автоматике, ручному режиму окна, очереди команд и подтверждённому состоянию.",
  );
}

// Slide 4. Analogue table.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.soft;
  addTitle(slide, "Аналоги закрывают отдельные части задачи", "Сравнение функций в выбранном масштабе одной комнаты");

  const values = [
    ["Решение", "Датчики", "История", "Прогноз", "Рекомендация", "Вентиляция", "Окно", "Локально"],
    ["Aranet4 HOME", "CO₂, T, RH", "+", "-", "±", "-", "-", "±"],
    ["Airthings View Plus", "CO₂, PM2.5, T/RH", "+", "-", "±", "-", "-", "±"],
    ["Sanobreeze", "CO₂", "-", "-", "-", "+", "-", "+"],
    ["AirGradient + Home Assistant", "CO₂, PM2.5, T/RH", "+", "-", "±", "+", "±", "+"],
    ["AirCheck", "CO₂, PM2.5, T/RH", "+", "+", "+", "+", "+", "+"],
  ];
  const table = slide.tables.add({
    rows: values.length,
    columns: values[0].length,
    left: 64,
    top: 164,
    width: 1152,
    height: 376,
    columnWidths: [290, 230, 95, 100, 130, 125, 85, 97],
    values,
  });
  table.styleOptions = { headerRow: false, bandedRows: false, bandedColumns: false };
  table.borders.assign({ style: "solid", fill: C.hairline, width: 1 });
  for (let row = 0; row < values.length; row += 1) {
    table.rows[row].height = row === 0 ? 52 : 64;
    for (let col = 0; col < values[row].length; col += 1) {
      const cell = table.getCell(row, col);
      const isHeader = row === 0;
      const isAirCheck = row === values.length - 1;
      const isSign = col >= 2;
      cell.fill = isHeader
        ? C.card
        : isAirCheck
          ? C.successSoft
          : row % 2 === 0
            ? C.canvas
            : "#FBFBFB";
      let color = isHeader ? C.ink : C.body;
      if (isSign && values[row][col] === "+") color = "#047857";
      if (isSign && values[row][col] === "±") color = "#B45309";
      if (isSign && values[row][col] === "-") color = C.muted;
      cell.text.style = {
        typeface: FONT,
        fontSize: isHeader ? 14 : 15,
        color,
        bold: isHeader || isAirCheck || isSign,
        alignment: isSign ? "center" : "left",
        verticalAlignment: "middle",
        autoFit: "shrinkText",
        wrap: "square",
        insets: { top: 8, right: 10, bottom: 8, left: 10 },
      };
    }
  }
  addText(slide, "Плюс означает заявленную или реализованную функцию. Минус означает, что функция не заявлена в рассмотренных материалах. Плюс-минус показывает частичную поддержку или необходимость настройки.", {
    left: 66,
    top: 566,
    width: 920,
    height: 38,
    size: 13,
    color: C.muted,
  });
  addText(slide, "Источники: официальные описания решений", {
    left: 970,
    top: 570,
    width: 246,
    height: 22,
    size: 12,
    color: C.mutedSoft,
    align: "right",
  });
  addFooter(slide, 4);
  slide.speakerNotes.textFrame.setText(
    "Источники аналогов: https://help.aranet.com/aranet4/aranet4-home/general/what-does-the-aranet4-do ; https://www.airthings.com/en/view-plus ; https://www.rylosystems.com/en_US/products/sanobreeze-co2-vent-controller ; https://www.airgradient.com/home-assistant/ ; https://www.home-assistant.io/docs/automation . Минус в таблице означает отсутствие функции в рассмотренном официальном описании. Таблица создана как редактируемый объект.",
  );
}

// Slide 5. Solution flow.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.canvas;
  addTitle(slide, "AirCheck связывает измерение с действием", "Проектный контур для одной комнаты");

  const flow = [
    ["Датчики", "внутри / снаружи", C.card],
    ["История", "PostgreSQL", C.canvas],
    ["Прогноз", "CO₂, 15 минут", C.blueSoft],
    ["Решение", "рекомендация", C.successSoft],
    ["Команды", "вытяжка / приток / окно", C.card],
  ];
  const flowShapes = [];
  flow.forEach((item, index) => {
    const left = 66 + index * 236;
    const node = addPanel(slide, { left, top: 218, width: 202, height: 128 }, {
      fill: item[2],
      line: HAIRLINE,
      radius: 16,
    });
    addText(slide, String(index + 1).padStart(2, "0"), {
      left: left + 18,
      top: 236,
      width: 32,
      height: 20,
      size: 13,
      color: C.muted,
      bold: true,
    });
    addText(slide, item[0], {
      left: left + 18,
      top: 264,
      width: 166,
      height: 30,
      size: 22,
      color: C.ink,
      bold: true,
    });
    addText(slide, item[1], {
      left: left + 18,
      top: 304,
      width: 166,
      height: 24,
      size: 14,
      color: C.body,
    });
    flowShapes.push(node);
  });
  for (let i = 0; i < flowShapes.length - 1; i += 1) {
    connect(slide, flowShapes[i], flowShapes[i + 1], {
      color: i === 2 ? C.success : C.mutedSoft,
      width: i === 2 ? 2.4 : 1.8,
    });
  }

  addRule(slide, 66, 416, 1110);
  addText(slide, "Состояние и управление", {
    left: 66,
    top: 447,
    width: 220,
    height: 22,
    size: 13,
    color: C.muted,
    bold: true,
  });
  addText(slide, "Ручная команда сохраняется до следующего решения оператора.", {
    left: 66,
    top: 481,
    width: 330,
    height: 44,
    size: 18,
    color: C.ink,
    bold: true,
  });
  addText(slide, "desired и reported состояния разделены. Команда считается выполненной только после подтверждения от узла.", {
    left: 456,
    top: 481,
    width: 356,
    height: 56,
    size: 17,
    color: C.body,
  });
  addText(slide, "Статус узла: online, stale или offline. Ожидающие команды остаются в очереди.", {
    left: 888,
    top: 481,
    width: 328,
    height: 56,
    size: 17,
    color: C.body,
  });
  addFooter(slide, 5);
  slide.speakerNotes.textFrame.setText(
    "Содержание основано на README AirCheck, docs/ml.md и docs/ТЗ-поправка-03-climate-control.md. В проекте предусмотрены измерения внутри и снаружи, прогноз CO₂ на 15 минут, рекомендации, отдельные каналы вытяжки и притока, автоматическое окно, reported/desired состояния и очередь команд.",
  );
}

// Slide 6. Goal and boundaries.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.soft;
  addTitle(slide, "Цель и границы проекта", "Что именно должна проверить дипломная работа");

  addText(slide, "Проверить локальный сценарий\nдля одной комнаты", {
    left: 66,
    top: 174,
    width: 450,
    height: 106,
    size: 33,
    color: C.ink,
    bold: true,
  });
  addText(slide, "Система по данным датчиков оценивает состояние воздуха, прогнозирует изменение CO₂ и поддерживает ручное или автоматическое управление проветриванием.", {
    left: 66,
    top: 320,
    width: 450,
    height: 100,
    size: 19,
    color: C.body,
  });

  addRule(slide, 610, 174, 1, C.hairline);
  const sections = [
    {
      top: 174,
      label: "В проекте уже есть",
      body: "панель, PostgreSQL, прогноз CO₂, рекомендации, настройки автоматики и очередь команд",
      color: C.success,
    },
    {
      top: 322,
      label: "Проверяется",
      body: "рост CO₂, ручное управление окном, автоматическое проветривание и подтверждение состояния",
      color: C.blue,
    },
    {
      top: 470,
      label: "Пока отсутствует",
      body: "физическая ESP32, реальные датчики, фильтр, моторы и механизм окна",
      color: C.warning,
    },
  ];
  sections.forEach((section) => {
    addShape(slide, "ellipse", { left: 642, top: section.top + 4, width: 14, height: 14 }, section.color, NO_LINE);
    addText(slide, section.label, {
      left: 680,
      top: section.top,
      width: 250,
      height: 22,
      size: 14,
      color: C.muted,
      bold: true,
    });
    addText(slide, section.body, {
      left: 680,
      top: section.top + 31,
      width: 472,
      height: 58,
      size: 18,
      color: C.ink,
    });
    addRule(slide, 680, section.top + 112, 472, C.hairlineSoft);
  });

  const band = addShape(slide, "rect", { left: 0, top: 606, width: W, height: 114 }, C.dark, NO_LINE);
  band.sendToBack();
  addText(slide, "Актуальность", {
    left: 66,
    top: 630,
    width: 180,
    height: 22,
    size: 13,
    color: "#A1A1AA",
    bold: true,
  });
  addText(slide, "Связать данные датчиков, прогноз и подтверждённое действие в одном локальном контуре.", {
    left: 264,
    top: 626,
    width: 820,
    height: 38,
    size: 22,
    color: C.white,
    bold: true,
  });
  addText(slide, "AirCheck / дипломная работа", {
    left: 264,
    top: 670,
    width: 260,
    height: 20,
    size: 13,
    color: "#A1A1AA",
  });
  addFooter(slide, 6, true);
  slide.speakerNotes.textFrame.setText(
    "Содержание основано на README AirCheck и разделах docs/ТЗ-поправка-03-climate-control.md и docs/ml.md. Ограничения отражают текущее состояние проекта: физическая ESP32 и реальные датчики ещё не подключены, simulator использует будущий контракт устройства.",
  );
}

await (await PresentationFile.exportPptx(presentation)).save(candidatePath);

for (let i = 0; i < presentation.slides.items.length; i += 1) {
  const slide = presentation.slides.items[i];
  const preview = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(
    path.join(buildDir, "draft-slide-" + String(i + 1) + ".png"),
    new Uint8Array(await preview.arrayBuffer()),
  );
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(
    path.join(buildDir, "draft-slide-" + String(i + 1) + ".layout.json"),
    await layout.text(),
  );
}

console.log(JSON.stringify({
  candidatePath,
  slideCount: presentation.slides.items.length,
  font: FONT,
}, null, 2));
