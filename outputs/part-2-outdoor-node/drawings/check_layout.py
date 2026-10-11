"""Conservative A3 sheet audit: bounds, cell clearance and text/line overlap."""
import json
import math
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parent
pdfmetrics.registerFont(TTFont("AuditGOST", r"C:\Windows\Fonts\GOST_BU.ttf"))
FACE = pdfmetrics.getFont("AuditGOST").face


def text_box(entity):
    x, y, _ = entity["position"]
    h = entity["height"]
    point_size = h * 1000 / FACE.capHeight
    width = pdfmetrics.stringWidth(entity["value"], "AuditGOST", point_size) * 25.4 / 72
    corners = [(-0.15, -0.22 * h), (width + 0.15, -0.22 * h),
               (width + 0.15, h + 0.15), (-0.15, h + 0.15)]
    angle = math.radians(entity.get("rotation", 0))
    c, s = math.cos(angle), math.sin(angle)
    pts = [(x + a * c - b * s, y + a * s + b * c) for a, b in corners]
    return [min(p[0] for p in pts), min(p[1] for p in pts),
            max(p[0] for p in pts), max(p[1] for p in pts)]


def boxes_intersect(a, b):
    return min(a[2], b[2]) - max(a[0], b[0]) > 0.1 and min(a[3], b[3]) - max(a[1], b[1]) > 0.1


def segment_hits_box(p1, p2, box):
    lo, hi = 0.0, 1.0
    for axis in (0, 1):
        delta = p2[axis] - p1[axis]
        if abs(delta) < 1e-10:
            if not box[axis] + 0.05 < p1[axis] < box[axis + 2] - 0.05:
                return False
            continue
        t1 = (box[axis] + 0.05 - p1[axis]) / delta
        t2 = (box[axis + 2] - 0.05 - p1[axis]) / delta
        lo = max(lo, min(t1, t2))
        hi = min(hi, max(t1, t2))
        if lo >= hi:
            return False
    return True


def main():
    entities = json.loads((ROOT / "drawing-entities.json").read_text(encoding="utf-8"))
    texts = [(i, e, text_box(e)) for i, e in enumerate(entities) if e["type"] == "Text"]
    issues = []
    for i, entity, box in texts:
        sheet = int(entity["position"][0] // 450) + 1
        origin = (sheet - 1) * 450
        if box[0] < origin + 20 or box[2] > origin + 415 or box[1] < 5 or box[3] > 292:
            issues.append({"kind": "outside_frame", "sheet": sheet,
                           "text": entity["value"], "bounds": box})
        missing = [char for char in entity["value"] if ord(char) not in FACE.charToGlyph]
        if missing:
            issues.append({"kind": "missing_glyph", "sheet": sheet,
                           "text": entity["value"], "characters": missing})
        if "_cell" in entity:
            x, y, width, height = entity["_cell"]
            if (box[0] < x + 0.4 or box[2] > x + width - 0.4
                    or box[1] < y + 0.4 or box[3] > y + height - 0.4):
                issues.append({"kind": "title_cell_clearance", "sheet": sheet,
                               "text": entity["value"], "bounds": box,
                               "cell": entity["_cell"]})
        for j, other, other_box in texts:
            if j > i and boxes_intersect(box, other_box):
                issues.append({"kind": "text_text", "sheet": sheet,
                               "text": entity["value"], "other": other["value"]})
        for graphic in entities:
            if graphic["type"] != "Line":
                continue
            p = graphic["start"][:2]
            q = graphic["end"][:2]
            if segment_hits_box(p, q, box):
                issues.append({"kind": "text_line", "sheet": sheet,
                               "text": entity["value"], "layer": graphic["layer"],
                               "line": [p, q]})
    result = {
        "sheets": 6,
        "format": "A3 landscape, 420 x 297 mm",
        "entities": len(entities),
        "text_entities": len(texts),
        "issues": issues,
        "method": "GOST BU font metrics, rotated text boxes, 0.4 mm title-cell clearance, segment intersection",
    }
    (ROOT / "layout-inspection.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
