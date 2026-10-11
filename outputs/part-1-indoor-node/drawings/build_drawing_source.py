"""Deterministic mm drawing source shared by OCS entities and PDF output."""
import json
from pathlib import Path
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('DrawingGOST',r'C:\Windows\Fonts\GOST_BU.ttf'))
FONT_FACE=pdfmetrics.getFont('DrawingGOST').face
RELEASE='R02'
def text_width(s,h):
    # Drawing height is in millimetres; ReportLab font sizes are in points.
    size=h*72/25.4*1000/FONT_FACE.capHeight
    return pdfmetrics.stringWidth(s,'DrawingGOST',size)*25.4/72

ROOT=Path(__file__).resolve().parent
E=[]
offset=0
def line(x,y,u,v,layer='D-OUTLINE'):
    E.append(dict(type='Line',layer=layer,start=[x+offset,y,0],end=[u+offset,v,0]))
def rect(x,y,w,h,layer='D-OUTLINE'):
    for a,b,c,d in [(x,y,x+w,y),(x+w,y,x+w,y+h),(x+w,y+h,x,y+h),(x,y+h,x,y)]: line(a,b,c,d,layer)
def text(x,y,s,h=3.5,angle=0):
    E.append(dict(type='Text',layer='D-TEXT',position=[x+offset,y,0],height=h,value=s,_rotation=angle))

def cell_text(x,y,w,h,s,size=2.5):
    # Use native Standard/txt.shx fixed-width metrics for the editable DWG;
    # keep a separate GOST BU TrueType position for the PDF renderer.
    baseline=y+(h-size)/2+0.2
    cad_width=len(s)*size*0.6
    cad_x=x+(w-cad_width)/2
    pdf_x=x+(w-text_width(s,size))/2
    text(cad_x,baseline,s,size)
    E[-1]['_pdf_position']=[pdf_x+offset,baseline,0]
    E[-1]['_cell']=[x+offset,y,w,h]
def circle(x,y,r,layer='D-OUTLINE'):
    E.append(dict(type='Circle',layer=layer,center=[x+offset,y,0],radius=r))
def cross(x,y,r=4):
    line(x-r,y,x+r,y,'D-CENTER');line(x,y-r,x,y+r,'D-CENTER')
def dimx(a,b,y,ext,label):
    line(a,ext,a,y+2,'D-DIM');line(b,ext,b,y+2,'D-DIM');line(a,y,b,y,'D-DIM')
    for x,sg in [(a,1),(b,-1)]:
        line(x,y,x+sg*2.5,y+0.8,'D-DIM');line(x,y,x+sg*2.5,y-0.8,'D-DIM')
    text((a+b-text_width(label,3.5))/2,y+2,label,3.5)
def dimy(a,b,x,ext,label):
    line(ext,a,x-2,a,'D-DIM');line(ext,b,x-2,b,'D-DIM');line(x,a,x,b,'D-DIM')
    for y,sg in [(a,1),(b,-1)]:
        line(x,y,x-0.8,y+sg*2.5,'D-DIM');line(x,y,x+0.8,y+sg*2.5,'D-DIM')
    text(x-2,(a+b-text_width(label,3.5))/2,label,3.5,90)
def notes(x,y,rows,h=3.5,step=7):
    for i,s in enumerate(rows):text(x,y-step*i,s,h)

def hatch_rect(x,y,w,h,step=3):
    # 45 degree section hatching clipped to a rectangular material region.
    for k in range(-int(h),int(w)+1,step):
        a=max(0,-k); b=min(h,w-k)
        if b>a:line(x+k+a,y+a,x+k+b,y+b,'D-DETAIL')

def model_section(name,x,y):
    # Boundary segments extracted by OpenCascade; even-odd hatch excludes voids.
    edges=json.loads((ROOT/'model-sections.json').read_text())[name]['segments']
    for a,b in edges:line(x+a[0],y+a[1],x+b[0],y+b[1])
    for k0 in range(-150,70,3):
        k=k0+0.137;hits=[]
        for a,b in edges:
            fa=a[1]-a[0]-k;fb=b[1]-b[0]-k
            if fa*fb<0:
                t=fa/(fa-fb);hits.append(a[0]+t*(b[0]-a[0]))
        hits=sorted(set(round(v,4) for v in hits))
        assert len(hits)%2==0,(name,k,hits)
        for a,b in zip(hits[::2],hits[1::2]):
            if b-a>0.001:line(x+a,y+a+k,x+b,y+b+k,'D-DETAIL')
def frame(n,title,designation,material='Сборка',scale='1:1'):
    global offset
    offset=(n-1)*450
    rect(20,5,395,287)
    text(26,282,title,5)
    text(26,274,f'AirCheck | внутренний узел | цифровой прототип {RELEASE} | размеры в мм',3.5)
    rect(230,5,185,55)
    line(295,5,295,60);line(295,45,415,45);line(295,20,415,20)
    line(365,5,365,45);line(365,30,415,30)
    line(380,30,380,45);line(395,30,395,45);line(390,20,390,30)
    for y in range(10,61,5):line(230,y,295,y,'D-DETAIL')
    for x in (250,267,282):line(x,5,x,60,'D-DETAIL')
    text(298,50,designation,5)
    short={1:['Узел измерительный','Сборочный чертёж'],2:['Основание'],3:['Крышка'],4:['Монтаж и отверстия']}[n]
    for i,s in enumerate(short):text(298,35-7*i,s,3.5)
    cell_text(365,38,15,7,'Лит.');cell_text(380,38,15,7,'Масса');cell_text(395,38,20,7,'Масш.')
    cell_text(365,30,15,8,'П',3.5);cell_text(395,30,20,8,scale,3.5)
    text(367,23,f'Лист {n}',2.5);text(392,23,'Листов 4',2.5)
    text(298,11,material,3.5);text(368,11,'AirCheck / ВКР',2.5)
    for i,s in enumerate(['Разраб.','Проверил','Т. контр.','Н. контр.','Утв.']):cell_text(230,25-5*i,20,5,s)
    for x,w,s in [(230,20,'Изм.'),(250,17,'Лист'),(267,15,'Подп.'),(282,13,'Дата')]:cell_text(x,50,w,5,s)
    text(26,10,'А3 420 x 297; печатать 100%; контроль линейкой 100 мм',2.5)
    line(26,20,126,20,'D-DIM');line(26,18,26,22,'D-DIM');line(126,18,126,22,'D-DIM')

def base_top(x,y,supports=True):
    rect(x,y,150,190);rect(x+4,y+4,142,182)
    for u in (14,136):
        for v in (14,176):circle(x+u,y+v,4.2);circle(x+u,y+v,1.25);cross(x+u,y+v)
    for u in (12,138):
        for v in (40,155):circle(x+u,y+v,2.25);cross(x+u,y+v)
    if supports:
        for u in (52.3,95.6):rect(x+u,y+8,2.1,36)
        rect(x+54.4,y+45.7,41.2,2)
        for v in (112.5,143):rect(x+90,y+v,48.3,2.5)
        for v in (143,168.86):rect(x+25,y+v,25.4,3)
        for u in (27.54,47.86):
            for v in (148.54,166.32):circle(x+u,y+v,2.5);circle(x+u,y+v,1.05)
        rect(x+58,y+138,2,44.4)
        rect(x+7.6,y+138,50.4,2)
        rect(x+58,y+145,2,6,'D-DETAIL')
    for u in (56,76):rect(x+u,y,18,4,'D-DETAIL')
    for v in (148,157,166):rect(x,y+v,4,5,'D-DETAIL')
    rect(x+146,y+124,4,14,'D-DETAIL')

frame(1,'Узел измерительный. Сборочный чертёж','AC-01-000 СБ')
base_top(40,75)
rect(94.4,79.5,41.2,41.2,'D-REF');text(98,96,'3 SPS30',3.5)
rect(65,221,25.4,22.86,'D-REF');text(67,231,'4',3.5)
rect(130,190,48.26,27.94,'D-REF');text(133,202,'5 ESP32',3.5)
dimx(40,190,65,75,'150');dimy(75,265,27,40,'190')
notes(215,263,['Вид со снятой крышкой; Z направлена к наблюдателю.',
 '1 - основание AC-01-001, 1 шт.', '2 - крышка AC-01-002, 1 шт. (здесь снята)',
 '3 - Sensirion SPS30, 1 шт.', '4 - Adafruit SCD-41 #5190, 1 шт.',
 '5 - ESP32-DevKitC-32E V4, 1 шт.', '6 - винт для пластика 3 x 12, 4 шт.',
 '7 - винт для пластика 2.5 x 8, 4 шт.',
 'Покупные платы показаны габаритами (LOD0).',
 'Крышка 3 мм; общий размер 150 x 190 x 68.',
 'Четыре отверстия крышки: X=14/136, Y=14/176.',
 'Крепление к стене: 4 отв. Ø4.5, X=12/138, Y=40/155.',
 'Кабель USB выходит через правую стенку.',
 'SPS30: воздушная кромка обращена к Y=0.',
 'Зелёная сторона SPS30 обращена к основанию.',
 'Воздушные входы и выход - на одной кромке.',
 'Установить съёмную разделительную прокладку',
 'между группами входа/выхода после примерки.',
 'Разъём SPS30 со стороны Y=45.7; запас кабеля 15 мм.',
 'Физическая примерка и испытания ещё не выполнены.'],3.5,8)
text(215,88,'Сборка: см. документацию AC-01-000 РЭ и СП.',3.5)
text(215,79,'Отсек SCD41 отделён перегородкой толщиной 2.',3.5)

frame(2,'Основание','AC-01-001','PETG')
base_top(40,75)
line(30,89,200,89,'D-CENTER');text(30,93,'А',3.5);text(197,93,'А',3.5)
dimx(40,190,65,75,'150 ±0.3');dimy(75,265,27,40,'190 ±0.3')
text(230,263,'А-А. Поперечное сечение корпуса',3.5)
model_section('A-A',230,180)
dimx(230,380,170,180,'150');dimy(180,245,390,380,'65 ±0.3')
text(264,230,'4 отв. Ø2.5, глубина 11',3.5)
notes(220,150,['Начало координат - левый нижний угол основания.',
 'X вправо; Y вверх; Z от стены к крышке.',
 'Оболочка: стенки 4, дно 4; стойки крышки Ø8.4.',
 'Опоры SCD41: Ø5, верх Z=28; Ø2.1 до Z=12.5.',
 'Центры: X=27.54/47.86; Y=148.54/166.32.',
 'Полки SPS30: верх Z=22; внутренние X=54.4/95.6.',
 'Направляющие SPS30: Y=8..44; верх Z=36.3.',
 'Опоры ESP32: X=90..138.3; Y=112.5..115 /143..145.5.',
 'Верх опор Z=16; защёлки до Z=19.25.',
 'Вырез под разъём SPS30: X=65..85; Y=44..49; Z=20..37.',
 'Перегородка 2 мм: X=58..60, Y=138..182.4; Z до 64.7.',
 'Поперечная часть: X=7.6..58, Y=138..140.',
 'Проход провода: Y=145..151; Z=40..48; см. 3D.',
 'Неуказанные линейные отклонения ±0.3 мм.',
 'Посадки и пилотные отверстия уточнить пробой PETG.'],3.5,6)
text(40,37,'Острые кромки зачистить; поверхности плат и сенсора не нагружать.',3.5)
text(40,29,'Печатать дном Z=0 на столе. Опоры под мостами/защёлками - локальные.',3.5)

frame(3,'Крышка','AC-01-002','PETG')
rect(40,75,150,190)
line(30,170,200,170,'D-CENTER');text(30,178,'Б',3.5);text(203,178,'Б',3.5)
rect(44.3,79.3,141.4,181.4,'D-DETAIL');rect(47.3,82.3,135.4,175.4,'D-DETAIL')
for u in (14,136):
    for v in (14,176):circle(40+u,75+v,1.7);cross(40+u,75+v)
dimx(40,190,65,75,'150 ±0.3');dimy(75,265,27,40,'190 ±0.3')
dimx(54,176,247,251,'122');dimy(89,251,212,176,'162')
text(230,261,'Б-Б. Сечение по бортику (1:1)',3.5)
model_section('B-B',230,151)
notes(230,194,['Пластина: 150 x 190 x 3.',
 'Внешний контур бортика: 141.4 x 181.4.',
 'Толщина бортика 3; выступ внутрь 3.5.',
 'Зазор бортик-стенка: 0.3 на сторону.',
 'Четыре сквозных отверстия Ø3.4.',
 'Центры: X=14/136; Y=14/176.',
 'В сборке плоскость стыка Z=65, наружная Z=68.',
 'Печатать наружной плоскостью вниз.',
 'Использовать файл lid-print.stl: Z=0..6.5.',
 'Неуказанные линейные отклонения ±0.3 мм.',
 'Резьбу в крышке не выполнять.',
 'Снятие крышки - после отключения питания.'],3.5,9)
text(40,40,'Вид на внутреннюю сторону. Бортик показан тонкими линиями.',3.5)
text(40,30,'Надпись room-01 / AirCheck наносить наклейкой на наружную поверхность.',3.5)

frame(4,'Монтаж и воздушные отверстия','AC-01-000 МЧ')
text(40,262,'Стенка Y=0, вид снаружи; X вправо, Z вверх',3.5)
rect(40,180,150,65)
for u in (56,76):rect(40+u,198,18,24)
line(110,190,110,235,'D-CENTER');text(113,191,'В',3.5);text(113,235,'В',3.5)
dimx(40,96,170,180,'56');dimx(96,114,228,222,'18');dimx(116,134,228,222,'18')
dimy(180,198,180,190,'18');dimy(198,222,198,190,'24')
text(230,262,'Правая стенка X=150; Y вправо, Z вверх',3.5)
rect(230,180,95,32.5)
rect(230+124*.5,180+14*.5,14*.5,11*.5)
text(230,249,'Вид справа - масштаб 1:2; размеры номинальные',3.5)
text(356,240,'В-В, местно 2:1',3.5)
# Port-edge section: wall Y=0..4, 0.5 gap, sensor Y=4.5 onwards.
rect(345,180,8,8);rect(345,236,8,8)
hatch_rect(345,180,8,8);hatch_rect(345,236,8,8)
rect(354,196,40,24.6,'D-REF')
line(337,208,367,208,'D-DIM')
line(337,208,340,209,'D-DIM');line(337,208,340,207,'D-DIM')
text(355,227,'Зазор 0.5',2.5)
text(356,203,'SPS30',3.5)
notes(230,170,['USB: Y=124..138; Z=14..25; окно 14 x 11.',
 'Левая стенка X=0: три окна 5 x 23.',
 'Y=148..153 /157..162 /166..171; Z=18..41.',
 'Радиусы углов окон в модели R0; зачистить кромки.'],3.5,8)
text(40,143,'Вид на стену: отверстия X=12/138, Y=40/155',3.5)
rect(40,45,75,95)
for u in (12,138):
    for v in (40,155):circle(40+u*.5,45+v*.5,1.125);cross(40+u*.5,45+v*.5,2)
text(40,35,'Схема центров, 1:2; шаг 126 x 115',3.5)
notes(135,126,['Разметить 4 центра по таблице, проверить 126 и 115.',
 'Крепёж стены подбирать по материалу основания.',
 'Не ставить узел над батареей, у плиты и под солнцем.',
 'Перед окнами оставить не менее 50 мм свободного места.',
 'Питание: внешний адаптер USB 5 В, 2 А.',
 'В корпус заводится только низкое напряжение.',
 'Печатный корпус не имеет подтверждённого класса IP.',
 'После сборки проверить воздухообмен и тепловую ошибку.'],3.5,7)

if __name__=='__main__':
    (ROOT/'drawing-entities.json').write_text(json.dumps(E,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'{len(E)} entities; 4 sheets A3; mm')
