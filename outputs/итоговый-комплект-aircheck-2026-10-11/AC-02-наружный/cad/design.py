"""AC-02 R01, mm: common CSG recipe for OpenCAD Studio and OpenCascade.

X right, Y up, Z away from the wall. All primitives are explicit nominal
dimensions; no purchased shape is silently treated as measured hardware.
"""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def B(x,y,z,dx,dy,dz):return dict(kind='box',p=[x,y,z],size=[dx,dy,dz])
def C(x,y,z,r,h):return dict(kind='cylinder',p=[x,y,z],radius=r,height=h)
MOUNT=[(x,y) for x in (8,152) for y in (30,162)]
LID=[(x,y) for x in (14,146) for y in (14,166)]
SHT=[(14+x,28+y) for x in (2.54,22.86) for y in (2.54,15.24)]
parts={}
add=[B(0,0,0,160,180,60)]
cut=[B(4,4,4,152,172,57)]
add += [C(x,y,3.8,4.2,55.7) for x,y in LID]
add += [C(x,y,3.8,2.5,14.2) for x,y in SHT]
# Two cover fasteners also anchor the shallow SHT45 radiation screen.
add += [C(52,y,3.8,3.5,22) for y in (24,50)]
add += [B(87.9,8,3.8,2.1,36,32.5),B(131.2,8,3.8,2.1,36,32.5),
        B(89.8,8,20,1.5,36,2),B(129.9,8,20,1.5,36,2),B(90,45.7,3.8,41.2,2,26.2),
        # ESP32-DevKitC is rotated 90 deg: USB points through the left wall.
        B(14,80,3.8,48.26,1.5,12.2),B(14,106.44,3.8,48.26,1.5,12.2),
        *[B(x,y,3.8,3.5,3.5,12.2) for x in (14,58.76) for y in (80,106)]]
cut += [C(x,y,48.5,1.25,12) for x,y in LID]
cut += [C(x,y,9,1.05,10) for x,y in SHT]
cut += [C(52,y,14.8,1.25,14.2) for y in (24,50)]
cut += [C(x,y,-1,2.25,6) for x,y in MOUNT]
cut += [B(x,-1,18,18,6,24) for x in (92,112)]
cut += [B(-1,y,16,6,6,12) for y in (24,34,44)]
cut += [B(-1,88.5,15.5,6,11,7),B(100,45.7,20,20,4.3,17)]
cut += [B(x,y,-1,3,5,6) for x,ys in ((83,(15,35)),(136,(15,35)),(9,(79,105)),(65,(79,105))) for y in ys]
# The hollow shell must be cut before its interior bosses and supports are fused.
parts['AC-02-001-base']=dict(name='Основание',shell=[add[0],cut[0]],add=add[1:],cut=cut[1:],print_transform='identity')
parts['AC-02-002-lid']=dict(name='Крышка',shell=[B(0,0,60,160,180,3)],
    add=[B(4.3,4.3,56.5,151.4,171.4,3.7)],
    cut=[B(7.3,7.3,56,145.4,165.4,4),*[C(x,y,59.9,1.7,4) for x,y in LID]],print_transform='flip_lid')
# Hood: open back and bottom, 4 mm side walls, 19 mm front air gap.
parts['AC-02-003-hood']=dict(name='Козырёк-экран',
    # Form roof, both side panels and the closed wall from one hollowed blank.
    # Extending the cavity past the open bottom/front prevents coincident faces.
    shell=[B(-8,0,-4,176,190,90),B(-4,-0.2,-5,168,186.0,87)],
    add=[*[B(x,y,-4,20,24,4) for x in (-8,148) for y in (18,150)]],
    cut=[C(x,y,-5,2.25,6) for x,y in MOUNT],print_transform='hood_front_down')
# Carrier: 3 mm rear frame and four integral 5 mm standoffs.
parts['AC-02-004-bracket']=dict(name='Кронштейн настенный',shell=[B(0,18,-12,160,24,3)],
    add=[B(0,150,-12,160,24,3),B(0,18,-12,16,156,3),B(144,18,-12,16,156,3),
         *[B(x-6,y-6,-9.2,12,12,5.2) for x,y in MOUNT]],
    cut=[C(x,y,-13,2.25,10) for x,y in MOUNT],print_transform='bracket_back_down')
parts['AC-02-005-sht-screen']=dict(name='Экран камеры SHT45',shell=[B(4.3,20,25.8,40.7,34,3)],
    add=[B(40.4,20,19.6,3,34,6.4),B(4.3,20,19.6,32.9,3,6.4),B(4.3,51,19.6,32.9,3,6.4),
         # Lightweight outriggers preserve the existing two screw supports without
         # extending the sensor's enclosed air chamber.
         B(40,20,25.8,16,6,3),B(40,48,25.8,16,6,3)],
    cut=[*[C(52,y,25.6,1.7,3.4) for y in (24,50)]],print_transform='screen_roof_down')
refs={
 'REF-SPS30':dict(name='Sensirion SPS30 LOD0',shell=[B(90,4.5,22,41.2,41.2,12.3)],add=[],cut=[]),
 'REF-SHT45':dict(name='Adafruit SHT45 #5665 LOD0',shell=[B(14,28,18,25.4,17.78,1.6)],add=[B(25.5,35.69,19.6,2.4,2.4,1)],cut=[C(x,y,17,1.25,4) for x,y in SHT]),
 'REF-ESP32':dict(name='ESP32-DevKitC-32E V4 LOD0, USB toward -X',shell=[B(14,80,16,48.26,27.94,1.6)],add=[],cut=[]),
}
# Electronics are separate solids in the native assembly; never fuse them to PCB.
ref_extra=[B(4,89.44,16,10,9,6),B(34,85.94,17.6,25.5,18,3.2),
           *[B(15.27,yy,z,45.73,2.54,h) for yy in (86.73,102.67) for z,h in ((10,6),(17.6,2.5))]]
if __name__=='__main__':
    (ROOT/'cad/design.json').write_text(json.dumps(dict(parts=parts,refs=refs,ref_extra=ref_extra),ensure_ascii=False,indent=2),encoding='utf-8')
    print('5 printable parts; 3 purchased reference groups; mm')
