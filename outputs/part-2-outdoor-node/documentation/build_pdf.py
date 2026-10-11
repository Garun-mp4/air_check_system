"""Render the shared AC-02 drawing entities and Markdown into release PDFs."""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "documentation"
RELEASE = "R03"
FONT_DIR = Path(r"C:\Windows\Fonts")
pdfmetrics.registerFont(TTFont("DrawingGOST", str(FONT_DIR / "GOST_BU.ttf")))
pdfmetrics.registerFont(TTFont("Body", str(FONT_DIR / "arial.ttf")))
pdfmetrics.registerFont(TTFont("BodyBold", str(FONT_DIR / "arialbd.ttf")))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="BodyBold",
                              italic="Body", boldItalic="BodyBold")


def drawing_pdfs() -> list[Path]:
    entities = json.loads((ROOT / "drawings" / "drawing-entities.json").read_text(encoding="utf-8"))
    inspection = json.loads((ROOT / "drawings" / "layout-inspection.json").read_text(encoding="utf-8"))
    if inspection["issues"]:
        raise RuntimeError("Drawing geometry fails layout inspection")
    paths: list[Path] = []
    for sheet in range(6):
        path = ROOT / "drawings" / f"AC-02-sheet-{sheet + 1:02d}-{RELEASE}.pdf"
        page = canvas.Canvas(str(path), pagesize=(420 * mm, 297 * mm), pageCompression=1)
        page.setTitle(f"AirCheck AC-02 лист {sheet + 1} {RELEASE}")
        page.setAuthor("AirCheck project")
        page.setSubject("Цифровой прототип; размерный чертёж, единицы мм")
        offset = sheet * 450
        for entity in entities:
            p = entity.get("start", entity.get("position", entity.get("center")))
            if not offset <= p[0] < offset + 450:
                continue
            x, y = p[0] - offset, p[1]
            layer = entity["layer"]
            page.setStrokeColor(colors.black)
            page.setFillColor(colors.black)
            page.setLineWidth({"D-OUTLINE": 0.5, "D-DIM": 0.18,
                               "D-CENTER": 0.18, "D-DETAIL": 0.25,
                               "D-REF": 0.25, "D-TITLE": 0.25}.get(layer, 0.25) * mm)
            dash = {"D-CENTER": [7 * mm, 2 * mm, 1 * mm, 2 * mm],
                    "D-REF": [2 * mm, 1 * mm]}.get(layer, [])
            page.setDash(dash)
            if entity["type"] == "Line":
                page.line(x * mm, y * mm,
                          (entity["end"][0] - offset) * mm, entity["end"][1] * mm)
            elif entity["type"] == "Circle":
                page.circle(x * mm, y * mm, entity["radius"] * mm, stroke=1, fill=0)
            elif entity["type"] == "Text":
                size = entity["height"] * mm * 1000 / pdfmetrics.getFont("DrawingGOST").face.capHeight
                page.saveState()
                page.translate(x * mm, y * mm)
                page.rotate(entity.get("rotation", 0))
                page.setFont("DrawingGOST", size)
                page.drawString(0, 0, entity["value"])
                page.restoreState()
        page.setDash()
        page.showPage()
        page.save()
        paths.append(path)

    combined = ROOT / "drawings" / f"AC-02-drawings-{RELEASE}.pdf"
    writer = PdfWriter()
    for path in paths:
        writer.append(str(path))
    writer.add_metadata({"/Title": f"AirCheck AC-02 — комплект чертежей {RELEASE}",
                         "/Author": "AirCheck project",
                         "/Subject": "Шесть листов A3, единицы мм; цифровой прототип"})
    with combined.open("wb") as stream:
        writer.write(stream)
    paths.append(combined)
    return paths


def inline(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)",
                  r'<link href="\2" color="#204b68">\1</link>', text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r'<font name="BodyBold">\1</font>', text)
    return text


body = ParagraphStyle("Body", fontName="Body", fontSize=9.2, leading=12.1,
                      textColor=colors.HexColor("#172b34"), spaceAfter=5,
                      splitLongWords=True)
small = ParagraphStyle("Small", parent=body, fontSize=7.2, leading=9.2,
                       spaceAfter=0)
head1 = ParagraphStyle("H1", parent=body, fontName="BodyBold", fontSize=15,
                       leading=19, spaceBefore=4, spaceAfter=10, keepWithNext=True)
head2 = ParagraphStyle("H2", parent=body, fontName="BodyBold", fontSize=11.5,
                       leading=14.5, spaceBefore=9, spaceAfter=6, keepWithNext=True)
head3 = ParagraphStyle("H3", parent=head2, fontSize=10.2, leading=13,
                       spaceBefore=7, spaceAfter=4)
bullet_style = ParagraphStyle("Bullet", parent=body, leftIndent=12,
                              firstLineIndent=-8, bulletIndent=0)


def md_table(lines: list[str]) -> Table:
    data: list[list[Paragraph]] = []
    for row_i, line in enumerate(lines):
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-+:?", cell) for cell in cells):
            continue
        style = small if row_i else small
        data.append([Paragraph(inline(cell), style) for cell in cells])
    n = len(data[0])
    if n == 6 and data[0][0].getPlainText().startswith("Поз."):
        proportions = [0.06, 0.16, 0.21, 0.07, 0.12, 0.38]
    elif n == 3 and data[0][0].getPlainText().startswith("Откуда"):
        proportions = [0.34, 0.35, 0.31]
    elif n == 3:
        proportions = [0.18, 0.42, 0.40]
    elif n == 2:
        proportions = [0.28, 0.72]
    else:
        proportions = [1 / n] * n
    table = Table(data, colWidths=[175 * mm * v for v in proportions],
                  repeatRows=1, hAlign="LEFT", splitByRow=1)
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9da8af")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7edf0")),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#172b34")),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def markdown_story(path: Path) -> list:
    lines = path.read_text(encoding="utf-8").splitlines()
    story: list = []
    buf: list[str] = []

    def flush() -> None:
        if buf:
            story.append(Paragraph(inline(" ".join(buf)), body))
            buf.clear()

    i = 0
    while i < len(lines):
        value = lines[i].strip()
        if value.startswith("|"):
            flush()
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            story.extend([md_table(table_lines), Spacer(1, 6)])
            continue
        if value.startswith("#"):
            flush()
            depth = len(value) - len(value.lstrip("#"))
            story.append(Paragraph(inline(value.lstrip("# ")), {1: head1, 2: head2}.get(depth, head3)))
        elif not value:
            flush()
        elif value.startswith("- "):
            flush()
            story.append(Paragraph("• " + inline(value[2:]), bullet_style))
        elif re.match(r"^\d+\.\s", value):
            flush()
            story.append(Paragraph(inline(value), body))
        else:
            buf.append(value)
        i += 1
    flush()
    if story and isinstance(story[-1], Spacer):
        story.pop()
    return story


def footer(page: canvas.Canvas, doc) -> None:
    page.saveState()
    page.setStrokeColor(colors.black)
    page.setLineWidth(0.5)
    page.rect(14 * mm, 10 * mm, 182 * mm, 277 * mm, stroke=1, fill=0)
    page.setFont("Body", 7.4)
    page.setFillColor(colors.HexColor("#273b44"))
    page.drawString(18 * mm, 13 * mm, f"AirCheck | AC-02 | {RELEASE} | 11.10.2026 | цифровой прототип")
    page.drawRightString(193 * mm, 13 * mm, f"Лист {doc.page}")
    page.restoreState()


def documentation_pdf() -> Path:
    path = DOC / f"AC-02-documentation-{RELEASE}.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=(210 * mm, 297 * mm),
                            leftMargin=18 * mm, rightMargin=17 * mm,
                            topMargin=17 * mm, bottomMargin=21 * mm,
                            title=f"AirCheck AC-02: спецификация и руководство {RELEASE}",
                            author="AirCheck project")
    story = [
        Paragraph("AirCheck. Наружный измерительный узел", head1),
        Paragraph(f"AC-02 • комплект документации {RELEASE} • 11.10.2026", body),
        Spacer(1, 8),
        Paragraph("В комплект входят рабочая спецификация, руководство по сборке/эксплуатации, нормативная матрица и протокол цифровой проверки.", body),
        Paragraph("Платы не куплены, принтер и пластик не выбраны. Чертежи и модели предназначены для прототипирования; фактическая посадка, наружная защита и точность измерений не испытаны.", body),
        Paragraph("Установка по исходному условию — под навесом. Корпус не имеет заявленного IP-класса.", body),
    ]
    for name in ("AC-02-000-SP.md", "AC-02-000-RE.md",
                 "standards-and-sources.md", "validation.md",
                 "drawing-audit-R03.md"):
        story.append(PageBreak())
        story.extend(markdown_story(DOC / name))
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return path


if __name__ == "__main__":
    paths = drawing_pdfs()
    paths.append(documentation_pdf())
    checks = []
    for path in paths:
        reader = PdfReader(str(path))
        page_text = [page.extract_text() or "" for page in reader.pages]
        if not page_text or any(len(text) < 80 for text in page_text):
            raise RuntimeError(f"PDF page is empty or lost its text layer: {path}")
        page_sizes = [[round(float(page.mediabox.width) / mm, 3),
                       round(float(page.mediabox.height) / mm, 3)] for page in reader.pages]
        checks.append({"file": path.relative_to(ROOT).as_posix(),
                       "pages": len(reader.pages), "page_sizes_mm": page_sizes,
                       "characters": [len(text) for text in page_text]})
    if checks[-2]["pages"] != 6 or checks[-2]["page_sizes_mm"] != [[420.0, 297.0]] * 6:
        raise RuntimeError("Combined drawing PDF must contain six A3 landscape pages")
    report = {"files": checks, "source_layout_issues": [],
              "rotation_source": "entity.rotation in drawing-entities.json",
              "font": "GOST_BU embedded subset for drawings; Arial for documentation"}
    (DOC / "pdf-inspection.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
