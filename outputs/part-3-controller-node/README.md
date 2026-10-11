# AirCheck AC-03 — узел управления и связи

**Текущая ревизия чертежей и документации: R02. Геометрия CAD и печатные сетки: R01.** Компоненты не закуплены; это цифровой прототип.

## Комплект

| Материал | Файл |
|---|---|
| Пять листов A3, PDF R02 | [AC-03-drawings-R02.pdf](drawings/AC-03-drawings-R02.pdf) |
| Редактируемые листы DXF R2013 / AC1027, мм | [AC-03-drawings-R02.dxf](drawings/AC-03-drawings-R02.dxf) |
| Исходные сущности, аудит компоновки и DXF | [drawing-entities-R02.json](drawings/drawing-entities-R02.json), [layout-audit-R02.json](drawings/layout-audit-R02.json) |
| Нативная 3D-сборка OpenCAD Studio, DWG AC1032 | [AC-03-000-assembly-R01.dwg](cad/model/AC-03-000-assembly-R01.dwg) |
| STEP сборки и печатных тел | [сборка](cad/model/AC-03-000-assembly-R01.step), [основание](cad/model/AC-03-001-base-print-R01.step), [крышка](cad/model/AC-03-002-lid-print-R01.step) |
| STL, печатать без масштабирования, мм | [основание](manufacturing/AC-03-001-base-print-R01.stl), [крышка](manufacturing/AC-03-002-lid-print-R01.stl) |
| Исходные размеры и построитель геометрии | [design.json](cad/design.json), [build_models.py](manufacturing/build_models.py) |
| Функциональная схема, исходник draw.io | [AC-03-connections.drawio](documentation/AC-03-connections.drawio) |
| Спецификация, руководство и BOM | [AC-03-000-SP.md](documentation/AC-03-000-SP.md), [AC-03-000-RE.md](documentation/AC-03-000-RE.md), [BOM.csv](documentation/BOM.csv) |
| Сводная документация PDF R02 | [AC-03-documentation-R02.pdf](documentation/AC-03-documentation-R02.pdf) |
| Проверка чертежей и цифровой выпуск | [drawing-audit-R02.md](documentation/drawing-audit-R02.md), [validation-R02.md](documentation/validation-R02.md), [standards-and-sources.md](documentation/standards-and-sources.md) |
| Исторические проверки геометрии R01 | [model-inspection-R01.json](manufacturing/model-inspection-R01.json), [dwg-verification-R01.json](documentation/dwg-verification-R01.json) |
| Контрольная сумма текущего комплекта | [manifest-sha256.json](manifest-sha256.json) |

## Что исправлено в R02

Аудит согласовал отверстия крышки с координатами модели, добавил координаты заднего кабельного прохода и секущие следы А-А/Б-Б, зеркально исправил положение прохода на заднем виде, определил начало координат на деталировочных листах, устранил пересечения надписей и переполнение ячеек основных таблиц. Высоты шрифта приведены к выбранному ряду ГОСТ 2.304-81. Таблица сигналов явно показывает подтяжки NC-входов и аппаратное выключение драйверов при сбросе. Подробности и ограничения приведены в отчёте аудита.

## Базовая компоновка и ограничения

Референсная плата — ESP32-DevKitC-32E V4 без нижних гребёнок; её контур и положение в CAD — LOD0, а не точная заводская модель. Основание 140 × 110 × 55 мм, крышка 146 × 116 × 8 мм. Номинальные зазор крышки 0,4 мм/сторону и габариты не проверены на купленных деталях или конкретном принтере.

Узлы A/B передают измерения шлюзу C по ESP-NOW; шлюз работает с AirCheck API и общим `device_id=room-01`. Функциональный лист и таблица GPIO не являются принципиальной электрической схемой Э3. Драйверы, вентиляторы, привод окна, кабели, источник питания нагрузок и принтер не выбраны. К GPIO нельзя подключать нагрузки напрямую.

**До изготовления:** подтвердить точную плату и разъём, выбрать драйверы и нагрузки, проверить питание, распечатать тест посадки и крышки, проверить безопасные состояния GPIO/концевиков, согласовать применённые редакции ЕСКД. Не заявлены физическая сборка, тепловой режим, электрическая безопасность, EMC, степень IP или нормоконтроль.
