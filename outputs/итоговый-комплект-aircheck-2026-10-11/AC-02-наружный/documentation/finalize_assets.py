"""Generate editable connection diagram, tabular BOM and package checksums."""
import csv
import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "documentation"


def connection_diagram() -> Path:
    mx = ET.Element("mxfile", host="app.diagrams.net", version="26",
                    modified="2026-10-12T00:00:00Z")
    diagram = ET.SubElement(mx, "diagram", id="aircheck-ac02", name="Соединения AC-02")
    model = ET.SubElement(diagram, "mxGraphModel", dx="1230", dy="900",
                          grid="1", gridSize="10", page="1",
                          pageWidth="1230", pageHeight="900", math="0", shadow="0")
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", id="0")
    ET.SubElement(root, "mxCell", id="1", parent="0")

    def vertex(cell_id: str, label: str, x: int, y: int, w: int, h: int,
               fill: str, size: int = 16) -> None:
        style = ("rounded=0;whiteSpace=wrap;html=0;fontFamily=Arial;"
                 f"fontSize={size};fillColor={fill};strokeColor=#263944;"
                 "fontColor=#172b34;spacing=12;strokeWidth=2;align=left;")
        cell = ET.SubElement(root, "mxCell", id=cell_id, value=label,
                             style=style, vertex="1", parent="1")
        ET.SubElement(cell, "mxGeometry", x=str(x), y=str(y), width=str(w),
                      height=str(h), attrib={"as": "geometry"})

    def edge(cell_id: str, source: str, target: str, label: str,
             color: str, exit_y: float, entry_y: float) -> None:
        style = ("edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;"
                 "fontFamily=Arial;fontSize=14;strokeWidth=2;"
                 f"strokeColor={color};fontColor=#172b34;labelBackgroundColor=#ffffff;"
                 f"exitX=1;exitY={exit_y};entryX=0;entryY={entry_y};endArrow=block;endFill=1;")
        cell = ET.SubElement(root, "mxCell", id=cell_id, value=label,
                             style=style, edge="1", parent="1",
                             source=source, target=target)
        ET.SubElement(cell, "mxGeometry", relative="1", attrib={"as": "geometry"})

    vertex("title", "AirCheck AC-02 • наружный измерительный узел • R04\n"
           "Функциональная схема соединений; не принципиальная Э3", 25, 24, 1180, 74,
           "#e7edf0", 20)
    vertex("usb", "ПИТАНИЕ\n\nОдин адаптер USB\n5 В / 2 А\nMicro-USB ESP32\n\nНе подавать второй\nисточник на 5V / 3V3",
           35, 305, 220, 250, "#fff5df", 15)
    vertex("esp", "ESP32-DevKitC-32E V4\nESP32-WROOM-32E\n\nJ2.19: 5V от USB\nJ2.1: 3V3\nJ3.1 / J3.7: GND\nJ3.11: GPIO17 TX\nJ3.12: GPIO16 RX\nJ3.6: GPIO21 SDA\nJ3.3: GPIO22 SCL",
           385, 225, 350, 385, "#e4f0ee", 15)
    vertex("sht", "Adafruit SHT45 #5665\nверсия без PTFE\n\nVIN ← 3V3\nGND ← общий GND\nSDA ↔ GPIO21\nSCL ← GPIO22\nI²C address 0x44",
           870, 170, 300, 240, "#edf4ff", 15)
    vertex("sps", "Sensirion SPS30\nJST ZHR-5\n\npin 1 VDD ← 5V\npin 2 RX ← GPIO17 TX\npin 3 TX → GPIO16 RX\npin 4 SEL: NC / floating\npin 5 GND ← общий GND\nUART 115200, 8N1",
           870, 465, 300, 280, "#eef5e6", 15)
    edge("usb_link", "usb", "esp", "USB 5 V", "#c07a1e", 0.5, 0.75)
    edge("sht_link", "esp", "sht", "I²C", "#3971a8", 0.26, 0.64)
    edge("sps_link", "esp", "sps", "UART 5 V", "#3d7d50", 0.77, 0.5)
    vertex("notes", "Перед включением: сверить маркировку и ревизии плат. Для SPS30 оставить незамкнутый pin 4 SEL; порты датчика не перекрывать. "
           "Показаны логические соответствия, а не цвета проводов и не схема разводки PCB. Монтаж и физические измерения не проверены.",
           35, 800, 1135, 76, "#f6f7f5", 14)
    ET.indent(mx)
    path = DOC / "AC-02-connections.drawio"
    ET.ElementTree(mx).write(path, encoding="utf-8", xml_declaration=True)
    return path


def bom_csv() -> Path:
    rows = []
    lines = (DOC / "AC-02-000-SP.md").read_text(encoding="utf-8").splitlines()
    in_table = False
    for line in lines:
        if line.startswith("| Поз."):
            in_table = True
            continue
        if in_table and not line.startswith("|"):
            break
        if in_table and line.startswith("|"):
            row = [part.strip() for part in line.strip().strip("|").split("|")]
            if row and not all(set(cell) <= {"-", ":"} for cell in row):
                rows.append(row)
    path = DOC / "BOM.csv"
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream, delimiter=";")
        writer.writerow(["Поз.", "Обозначение", "Наименование", "Кол.", "Категория", "Примечание"])
        writer.writerows(rows)
    return path


def manifest() -> Path:
    rows = []
    for path in sorted(ROOT.rglob("*")):
        if (path.is_file() and path.name != "manifest-sha256.json"
                and not path.name.endswith((".ocs.lock", ".sv$"))
                and "__pycache__" not in path.parts):
            payload = path.read_bytes()
            rows.append({"file": path.relative_to(ROOT).as_posix(),
                         "bytes": len(payload),
                         "sha256": hashlib.sha256(payload).hexdigest()})
    out = ROOT / "manifest-sha256.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


if __name__ == "__main__":
    print(json.dumps({"diagram": str(connection_diagram()), "bom": str(bom_csv()),
                      "manifest": str(manifest())}, ensure_ascii=False))
