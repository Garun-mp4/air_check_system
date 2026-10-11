"""Generate editable connection drawing, BOM and checksums. No network required."""
import csv,json,hashlib,xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[1]

def connections():
    mx=ET.Element('mxfile',host='app.diagrams.net',version='26',modified='2026-10-12T00:00:00Z')
    d=ET.SubElement(mx,'diagram',id='aircheck-01',name='Соединения AC-01')
    m=ET.SubElement(d,'mxGraphModel',dx='1200',dy='850',grid='1',gridSize='10',page='1',pageWidth='1200',pageHeight='850')
    r=ET.SubElement(m,'root');ET.SubElement(r,'mxCell',id='0');ET.SubElement(r,'mxCell',id='1',parent='0')
    def node(id,value,x,y,w,h,fill='#ffffff'):
        c=ET.SubElement(r,'mxCell',id=id,value=value,style=f'rounded=0;whiteSpace=wrap;html=0;fontFamily=Arial;fontSize=16;fillColor={fill};strokeColor=#283840;fontColor=#172b34;spacing=12;',vertex='1',parent='1')
        ET.SubElement(c,'mxGeometry',x=str(x),y=str(y),width=str(w),height=str(h),attrib={'as':'geometry'})
    def edge(id,source,target,label,style=''):
        c=ET.SubElement(r,'mxCell',id=id,value=label,source=source,target=target,style='edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;fontFamily=Arial;fontSize=14;strokeWidth=2;labelBackgroundColor=#ffffff;'+style,edge='1',parent='1')
        ET.SubElement(c,'mxGeometry',relative='1',attrib={'as':'geometry'})
    node('title','AirCheck AC-01 • внутренний узел • R02\nФункциональная схема соединений; не Э3 по ЕСКД',30,20,1140,70,'#e7edf0')
    node('usb','Внешний USB-адаптер\n5 В / 2 А\nЕдинственный источник',30,170,250,130)
    node('esp','ESP32-DevKitC-32E V4\nMicro-B: питание\nJ2.19: отвод 5V\nJ3.1/7: GND\nJ3.6: GPIO21 SDA\nJ3.3: GPIO22 SCL\nJ3.12: GPIO16 RX\nJ3.11: GPIO17 TX',400,170,330,290,'#edf6f5')
    node('scd','Adafruit SCD-41 #5190\nVIN ← 5V; GND общий\nSDA ↔ GPIO21\nSCL ← GPIO22\nI2C подтяжки: только 3.3 В',870,160,300,170)
    node('sps','Sensirion SPS30\n1 VDD ← 5V; 5 GND общий\n3 TX → GPIO16 RX\n2 RX ← GPIO17 TX\n4 SEL: не подключать\nUART 115200 / 8N1',870,410,300,200)
    edge('p','usb','esp','USB','exitX=1;exitY=0.5;entryX=0;entryY=0.2;')
    edge('i','esp','scd','I2C + питание','exitX=1;exitY=0.25;entryX=0;entryY=0.5;')
    edge('u','esp','sps','5V / GND / RX / TX','exitX=1;exitY=0.85;entryX=0;entryY=0.5;')
    node('notes','Перед включением: сверить маркировку контактов, ревизию PCB и перемычки SCD41 (Rev A errata).\nUSB и отдельный источник на 5V/3V3 одновременно не подключать. Цвет провода не определяет номер контакта.\nТочная монтажная таблица и порядок сборки: AC-01-000 РЭ. Прошивка в комплект CAD не входит.',30,670,1140,130,'#fff9eb')
    ET.indent(mx);ET.ElementTree(mx).write(root/'documentation/AC-01-connections.drawio',encoding='utf-8',xml_declaration=True)

def bom():
    text=(root/'documentation/AC-01-000-SP.md').read_text(encoding='utf-8')
    rows=[]
    for line in text.splitlines():
        if line.startswith('|'):
            row=[x.strip() for x in line.strip('|').split('|')]
            if row[0].isdigit():rows.append(row)
    with (root/'documentation/BOM.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f,delimiter=';');w.writerow(['Позиция','Наименование','Количество','Примечание'])
        for row in rows:
            if len(row)==5:w.writerow([row[0],row[1]+' '+row[2],row[3],row[4]])
            else:w.writerow(row)

def manifest():
    rows=[]
    for p in sorted(root.rglob('*')):
        if (p.is_file() and p.name!='manifest-sha256.json'
                and not p.name.endswith(('.ocs.lock', '.sv$'))
                and '__pycache__' not in p.parts):
            rows.append(dict(file=p.relative_to(root).as_posix(),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
    (root/'manifest-sha256.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8')

if __name__=='__main__':connections();bom();manifest();print('Connections, BOM and manifest written')
