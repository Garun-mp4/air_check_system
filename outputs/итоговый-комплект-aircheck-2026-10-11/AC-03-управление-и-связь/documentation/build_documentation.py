"""Build a readable AC-03 A4 documentation PDF from its Markdown sources."""
from __future__ import annotations

import argparse
import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle, KeepTogether)

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "documentation"
RELEASE = "R01"
pdfmetrics.registerFont(TTFont("Body", r"C:\Windows\Fonts\arial.ttf"))
pdfmetrics.registerFont(TTFont("BodyBold", r"C:\Windows\Fonts\arialbd.ttf"))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="BodyBold",
                              italic="Body", boldItalic="BodyBold")

INK = colors.HexColor("#172b34")
GRID = colors.HexColor("#a9b4ba")
PALE = colors.HexColor("#e7edf0")

body = ParagraphStyle("Body", fontName="Body", fontSize=9.0, leading=12.0,
                      textColor=INK, spaceAfter=4.5, splitLongWords=True)
small = ParagraphStyle("Small", parent=body, fontSize=7.35, leading=9.4,
                       spaceAfter=0, splitLongWords=True)
head1 = ParagraphStyle("H1", parent=body, fontName="BodyBold", fontSize=15,
                       leading=18, spaceBefore=4, spaceAfter=9, keepWithNext=True)
head2 = ParagraphStyle("H2", parent=body, fontName="BodyBold", fontSize=11.5,
                       leading=14.2, spaceBefore=7, spaceAfter=4, keepWithNext=True)
head3 = ParagraphStyle("H3", parent=head2, fontSize=10.0, leading=12.5,
                       spaceBefore=7, spaceAfter=4)
bullet = ParagraphStyle("Bullet", parent=body, leftIndent=12,
                        firstLineIndent=-8, bulletIndent=0, spaceAfter=2.7)


def inline(value: str) -> str:
    value = value.translate(str.maketrans({
        "\u2010": "-", "\u2011": "-", "\u2012": "-",
        "\u2013": "-", "\u2014": "-", "\u2212": "-",
    }))
    value = html.escape(value, quote=False)
    value = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)",
                   r'<link href="\2" color="#204b68">\1</link>', value)
    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", value)
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"`([^`]+)`", r'<font name="BodyBold">\1</font>', value)
    return value


def markdown_table(lines: list[str]) -> Table:
    rows: list[list[Paragraph]] = []
    for i, value in enumerate(lines):
        cells = [cell.strip() for cell in value.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-+:?", cell) for cell in cells):
            continue
        rows.append([Paragraph(inline(cell), small) for cell in cells])
    n = len(rows[0])
    header_text = " ".join(cell.getPlainText() for cell in rows[0]).casefold()
    ratios = {
        2: [0.30, 0.70],
        3: [0.17, 0.34, 0.49],
        4: [0.09, 0.22, 0.10, 0.59],
        5: [0.09, 0.20, 0.16, 0.16, 0.39],
    }.get(n, [1 / n] * n)
    if n == 4 and "gpio" in header_text and "ограничение" in header_text:
        # Give signal/function columns enough width so Russian pin descriptions
        # do not break into one word per line in the printed specification.
        ratios = [0.13, 0.14, 0.33, 0.40]
    table = Table(rows, colWidths=[174 * mm * part for part in ratios],
                  repeatRows=1, hAlign="LEFT", splitByRow=1)
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, GRID),
        ("BACKGROUND", (0, 0), (-1, 0), PALE),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]))
    return table


def markdown_story(path: Path) -> list:
    lines = path.read_text(encoding="utf-8").splitlines()
    story: list = []
    paragraph: list[str] = []

    def flush() -> None:
        if paragraph:
            story.append(Paragraph(inline(" ".join(paragraph)), body))
            paragraph.clear()

    i = 0
    while i < len(lines):
        value = lines[i].strip()
        if value.startswith("|"):
            flush()
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            story.extend([markdown_table(table_lines), Spacer(1, 4)])
            continue
        if value.startswith("#"):
            flush()
            depth = len(value) - len(value.lstrip("#"))
            style = {1: head1, 2: head2}.get(depth, head3)
            story.append(Paragraph(inline(value.lstrip("# ")), style))
        elif not value:
            flush()
        elif value.startswith("- "):
            flush()
            story.append(Paragraph("• " + inline(value[2:]), bullet))
        elif re.match(r"^\d+\.\s", value):
            flush()
            story.append(Paragraph(inline(value), body))
        else:
            paragraph.append(value)
        i += 1
    flush()
    return story


def footer(pdf, doc) -> None:
    pdf.saveState()
    pdf.setStrokeColor(colors.black)
    pdf.setLineWidth(0.5)
    pdf.rect(14 * mm, 10 * mm, 182 * mm, 277 * mm, stroke=1, fill=0)
    pdf.setFillColor(INK)
    pdf.setFont("Body", 7.2)
    pdf.drawString(18 * mm, 13 * mm,
                   f"AirCheck | AC-03 | {RELEASE} | 12.10.2026 | цифровой прототип")
    pdf.drawRightString(192 * mm, 13 * mm, f"Лист {doc.page}")
    pdf.restoreState()


def main() -> None:
    global RELEASE
    parser = argparse.ArgumentParser(description="Build the AC-03 documentation PDF")
    parser.add_argument("--release", default="R01", help="release label, for example R02")
    parser.add_argument("--overwrite", action="store_true",
                        help="replace the PDF of the selected release")
    args = parser.parse_args()
    if not args.release.startswith("R") or not args.release[1:].isdigit():
        parser.error("--release must look like R01")
    RELEASE = args.release
    output = DOC / f"AC-03-documentation-{RELEASE}.pdf"
    if output.exists() and not args.overwrite:
        parser.error(f"output already exists; pass --overwrite to replace it: {output.name}")
    template = SimpleDocTemplate(
        str(output), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=17 * mm, bottomMargin=21 * mm,
        title=f"AirCheck AC-03 — документация {RELEASE}",
        author="AirCheck project")
    story = [
        Paragraph("AirCheck. Узел управления и связи", head1),
        Paragraph(f"AC-03 • цифровой прототип • выпуск {RELEASE} • 12.10.2026", body),
        Spacer(1, 6),
        Paragraph("Состав: спецификация, руководство по сборке и проверке, нормативная матрица и цифровые протоколы. Подробные размеры и геометрия находятся в пятилистовом комплекте A3.", body),
        Paragraph("Плата, драйверы, нагрузки, принтер и материал не закуплены/не выбраны. До выбора реальных драйверов данный выпуск не является готовой электрической схемой и не разрешает подключать исполнительные устройства.", body),
    ]
    for filename in ("AC-03-000-SP.md", "AC-03-000-RE.md",
                     "standards-and-sources.md", f"validation-{RELEASE}.md",
                     f"drawing-audit-{RELEASE}.md"):
        source = DOC / filename
        if not source.exists():
            continue
        story.append(PageBreak())
        story.extend(markdown_story(source))
    template.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"generated={output.relative_to(ROOT).as_posix()} bytes={output.stat().st_size}")


if __name__ == "__main__":
    main()
