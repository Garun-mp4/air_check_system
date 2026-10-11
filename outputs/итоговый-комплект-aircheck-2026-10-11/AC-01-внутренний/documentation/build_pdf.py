"""Rebuild the six PDF deliverables from shared drawing entities and Markdown."""
import json,re,html
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,KeepTogether
from reportlab.lib import colors
from pypdf import PdfReader,PdfWriter

ROOT=Path(__file__).resolve().parents[1]
RELEASE='R02'
pdfmetrics.registerFont(TTFont('GOST',r'C:\Windows\Fonts\GOST_BU.ttf'))
pdfmetrics.registerFont(TTFont('Body',r'C:\Windows\Fonts\arial.ttf'))
pdfmetrics.registerFont(TTFont('Bold',r'C:\Windows\Fonts\arialbd.ttf'))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Body',boldItalic='Bold')

def drawings():
    entities=json.loads((ROOT/'drawings/drawing-entities.json').read_text(encoding='utf-8'))
    warnings=[]; paths=[]
    for sheet in range(4):
        path=ROOT/f'drawings/AC-01-sheet-{sheet+1}-{RELEASE}.pdf';paths.append(path)
        c=canvas.Canvas(str(path),pagesize=(420*mm,297*mm),pageCompression=1)
        c.setTitle(f'AirCheck AC-01 лист {sheet+1} {RELEASE}');c.setAuthor('AirCheck project')
        for e in entities:
            p=e.get('start',e.get('_pdf_position',e.get('position',e.get('center'))))
            if not sheet*450<=p[0]<(sheet+1)*450:continue
            x=p[0]-sheet*450;y=p[1];layer=e['layer']
            c.setStrokeColor(colors.black);c.setFillColor(colors.black)
            c.setLineWidth((0.5 if layer=='D-OUTLINE' else 0.18 if layer=='D-DIM' else 0.25)*mm)
            c.setDash(([7*mm,2*mm,1*mm,2*mm] if layer=='D-CENTER' else [3*mm,1.5*mm] if layer=='D-REF' else []))
            if e['type']=='Line':c.line(x*mm,y*mm,(e['end'][0]-sheet*450)*mm,e['end'][1]*mm)
            elif e['type']=='Circle':c.circle(x*mm,y*mm,e['radius']*mm,stroke=1,fill=0)
            elif e['type']=='Text':
                # TrueType cap height sets the specified drawing letter height.
                size=e['height']*mm*1000/pdfmetrics.getFont('GOST').face.capHeight
                c.saveState();c.translate(x*mm,y*mm);c.rotate(e.get('_rotation',0))
                c.setFont('GOST',size);c.drawString(0,0,e['value']);c.restoreState()
                width=pdfmetrics.stringWidth(e['value'],'GOST',size)/mm
                if x+width>414 or x<20 or y+e['height']>291:
                    warnings.append(dict(sheet=sheet+1,text=e['value'],x=x,y=y,right=x+width))
        c.showPage();c.save()
    w=PdfWriter()
    for p in paths:w.append(str(p))
    combined=ROOT/f'drawings/AC-01-drawings-{RELEASE}.pdf'
    w.write(str(combined))
    return paths+[combined],warnings

def inline(s):
    s=html.escape(s)
    s=re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)',r'<link href="\2" color="#204b68">\1</link>',s)
    s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'\1',s)
    s=re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',s)
    return s.replace('`','')

body=ParagraphStyle('Body',fontName='Body',fontSize=10.5,leading=14,spaceAfter=6,splitLongWords=True)
small=ParagraphStyle('Small',parent=body,fontSize=8,leading=10,spaceAfter=0)
head=ParagraphStyle('Head',parent=body,fontName='Bold',fontSize=14,leading=18,spaceBefore=9,spaceAfter=8,keepWithNext=True)
sub=ParagraphStyle('Sub',parent=head,fontSize=11,leading=15)
def para(s,style=body):return Paragraph(inline(s),style)

def table(rows):
    n=len(rows[0]);width=180*mm
    # Avoid microscopic columns for prose-heavy technical tables.
    proportions={2:[.27,.73],3:[.22,.51,.27],4:[.09,.48,.09,.34],5:[.08,.18,.48,.08,.18]}.get(n,[1/n]*n)
    if rows[0][0]=='Цепь':proportions=[.17,.25,.22,.36]
    data=[[para(cell,small) for cell in row] for row in rows]
    t=Table(data,colWidths=[width*p for p in proportions],repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),.4,colors.HexColor('#9da8af')),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e7edf0')),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    return t

def markdown(path):
    lines=path.read_text(encoding='utf-8').splitlines();story=[];i=0;buf=[]
    def flush():
        if buf:story.append(para(' '.join(buf)));buf.clear()
    while i<len(lines):
        s=lines[i].strip()
        if s.startswith('|'):
            flush();rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                row=[v.strip() for v in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?',v) for v in row):rows.append(row)
                i+=1
            story.extend([table(rows),Spacer(1,8)]);continue
        if s.startswith('#'):
            flush();story.append(para(s.lstrip('# '),head if s.startswith('# ') else sub))
        elif not s:flush()
        elif s.startswith('- ') or re.match(r'^\d+\. ',s):flush();story.append(para(s))
        else:buf.append(s)
        i+=1
    flush();return story

def footer(c,doc):
    c.saveState();c.setStrokeColor(colors.black);c.setLineWidth(.5)
    c.rect(20*mm,10*mm,185*mm,282*mm,stroke=1,fill=0)
    c.setFont('Body',8);c.drawString(23*mm,13*mm,f'AirCheck | AC-01 | {RELEASE} | 11.10.2026 | цифровой прототип')
    c.drawRightString(202*mm,13*mm,f'Лист {doc.page}');c.restoreState()

def manual():
    path=ROOT/f'documentation/AC-01-documentation-{RELEASE}.pdf'
    d=SimpleDocTemplate(str(path),pagesize=(210*mm,297*mm),leftMargin=23*mm,rightMargin=7*mm,topMargin=10*mm,bottomMargin=21*mm,title=f'AirCheck AC-01: документация {RELEASE}',author='AirCheck project')
    story=[para('AirCheck. Внутренний измерительный узел',head),para('Комплект документации AC-01. Выпуск R02 от 11.10.2026; корректировка оформления чертежей к цифровому прототипу R01.'),para('Состав: спецификация, изготовление и сборка, таблица соединений, установка и обслуживание, нормативная матрица, протокол цифровой проверки.'),para('Электроника не куплена; физическая приёмка не выполнена. Подписи, утверждение и полный нормоконтроль отсутствуют. См. границы готовности в конце комплекта.'),PageBreak()]
    for j,name in enumerate(['AC-01-000-SP.md','AC-01-000-RE.md','standards-and-sources.md','validation-R02.md','drawing-audit-R02.md']):
        if j:story.append(PageBreak())
        story.extend(markdown(ROOT/'documentation'/name))
    d.build(story,onFirstPage=footer,onLaterPages=footer)
    return path

if __name__=='__main__':
    paths,warnings=drawings();paths.append(manual());checks=[]
    for p in paths:
        r=PdfReader(str(p));texts=[page.extract_text() or '' for page in r.pages]
        assert all(len(t)>100 for t in texts),p
        checks.append(dict(file=str(p.relative_to(ROOT)),pages=len(r.pages),page_sizes_mm=[[round(float(pg.mediabox.width)/mm,3),round(float(pg.mediabox.height)/mm,3)] for pg in r.pages],characters=[len(t) for t in texts]))
    (ROOT/'documentation/pdf-inspection.json').write_text(json.dumps(dict(files=checks,text_bounds_warnings=warnings),ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(files=checks,text_bounds_warnings=warnings),ensure_ascii=False,indent=2))
