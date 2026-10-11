"""Check text collisions against text, lines and title-block cell borders (mm)."""
import json,math
from pathlib import Path
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
root=Path(__file__).resolve().parent
pdfmetrics.registerFont(TTFont('AuditGOST',r'C:\Windows\Fonts\GOST_BU.ttf'))
face=pdfmetrics.getFont('AuditGOST').face

def bbox(e):
    x,y,_=e['position'];h=e['height'];w=pdfmetrics.stringWidth(e['value'],'AuditGOST',h*1000/face.capHeight)
    # Conservative allowance for descenders, thin stroke and overhang.
    corners=[(-.15,-.22*h),(w+.15,-.22*h),(w+.15,h+.15),(-.15,h+.15)]
    a=math.radians(e.get('_rotation',0));c,s=math.cos(a),math.sin(a)
    p=[(x+u*c-v*s,y+u*s+v*c) for u,v in corners]
    return [min(v[0] for v in p),min(v[1] for v in p),max(v[0] for v in p),max(v[1] for v in p)]

def intersect(a,b):return min(a[2],b[2])-max(a[0],b[0])>0 and min(a[3],b[3])-max(a[1],b[1])>0

def segment_hits(a,b,r):
    lo,hi=0,1
    for k in (0,1):
        d=b[k]-a[k]
        if abs(d)<1e-10:
            if not r[k]<a[k]<r[k+2]:return False
        else:
            t1,t2=sorted(((r[k]-a[k])/d,(r[k+2]-a[k])/d));lo=max(lo,t1);hi=min(hi,t2)
            if lo>=hi:return False
    return True

if __name__=='__main__':
    E=json.loads((root/'drawing-entities.json').read_text(encoding='utf-8'))
    T=[(i,e,bbox(e)) for i,e in enumerate(E) if e['type']=='Text'];issues=[]
    for i,e,b in T:
        sheet=int(e['position'][0]//450)+1;ox=(sheet-1)*450
        if b[0]<ox+20 or b[2]>ox+415 or b[1]<5 or b[3]>292:issues.append(dict(kind='frame',sheet=sheet,text=e['value']))
        missing=[ch for ch in e['value'] if ord(ch) not in face.charToGlyph]
        if missing:issues.append(dict(kind='missing_glyph',sheet=sheet,text=e['value'],characters=missing))
        if '_cell' in e:
            x,y,w,h=e['_cell'];m=.4
            if b[0]<x+m or b[2]>x+w-m or b[1]<y+m or b[3]>y+h-m:issues.append(dict(kind='cell_clearance',sheet=sheet,text=e['value'],bounds=b,cell=e['_cell']))
        for j,f,fb in T:
            if j>i and intersect(b,fb):issues.append(dict(kind='text_text',sheet=sheet,text=e['value'],other=f['value']))
        for f in E:
            if f['type']=='Line' and segment_hits(f['start'],f['end'],b):issues.append(dict(kind='text_line',sheet=sheet,text=e['value'],line=[f['start'][:2],f['end'][:2]],layer=f['layer']))
    result=dict(checked_texts=len(T),checked_entities=len(E),issues=issues,method='GOST font metrics + conservative descender bounds; rotated text; segment clipping; 0.4 mm cell clearance')
    (root/'layout-inspection.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(bool(issues))
