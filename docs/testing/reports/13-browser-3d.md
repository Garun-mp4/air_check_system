# Блок 13 — браузерный 3D-стенд

## Область и границы

Проверен frontend-контур сцены, который принимает `SimulatorSnapshot` и строит React Three Fiber scene tree: компоновка комнаты и fan assemblies, фактическое положение створки, airflow props, cutaway/visualization modes, базовая обработка picking и передача команды камеры. Источники контракта: `docs/testing-domains.md`, `docs/web-simulator.md` и `aircheck_simulator_3d/docs/architecture.md`.

Тесты не проверяют расчёты Simulation Core и Device Layer, сетевой snapshot/SSE, общие dashboard/account компоненты, визуальные пиксели и работу реального WebGL renderer. REST, SSE и бизнес-логику соседних блоков не дублируют. В тестах используются минимальные snapshot fixtures с теми полями, которые читает проверяемый компонент.

## Добавленные файлы

| Файл | Новые проверки |
|---|---|
| `frontend/src/components/simulator/scene/sceneInteraction.test.ts` | 4: передача режимов и cutaway в слои сцены; очистка выбора при промахе ЛКМ и подавление контекстного меню; выбор pickable-объекта ЛКМ и игнорирование других кнопок; возврат камеры и target к стартовой позе после reset. |
| `frontend/src/components/simulator/scene/snapshotScene.test.ts` | 6: расположение и snapshot state вентиляторов; selectable IDs окна и вентиляторов; угол створки из `actual_position_percent`; передача фактических расходов и видимости в airflow tracks; свободные проёмы стены напротив окна и sleeve вентиляторов; visible/transparent/hidden фасад. |
| `docs/testing/reports/13-browser-3d.md` | Этот отчёт с границами, результатами и ограничениями проверки. |

Текущие проверки уже покрывают маршруты и точки соединения проводов, mounting geometry, mapping кнопок OrbitControls (ЛКМ pan/ПКМ rotate/средняя кнопка dolly), WASD/QE/Shift input filtering и focus easing. Они включены в полный целевой прогон без изменения существующих файлов.

## Результаты

Команды запускались из `frontend/`:

| Команда | Результат |
|---|---|
| `npm test -- --reporter=verbose src/components/simulator/scene/sceneInteraction.test.ts src/components/simulator/scene/snapshotScene.test.ts` | 2 файла; 10 passed, 0 failed, 0 skipped. |
| `npm test -- --reporter=verbose src/components/simulator/scene` | Полный целевой каталог: 7 файлов; 34 passed, 0 failed, 0 skipped. |
| `npm run typecheck` | `tsc --noEmit` завершился успешно. |
| `git diff --cached --check` | Проверка пробелов и конфликтных маркеров; запускалась после добавления в index только трёх файлов блока 13. |

В первом локальном прогоне новые тесты сначала упали из-за отсутствующей глобальной ссылки `React` в Vitest transform для прямого вызова TSX-компонентов. В тестах установлена ссылка на существующий React module, после чего компонентные проверки выполнились. Следующий прогон выявил только чрезмерно точные сравнения вычисленных floating-point координат; assertions заменены на сравнения с допуском. Это были ошибки harness/assertions, не дефекты продукта. Итоговый целевой прогон полностью зелёный. Vitest также выводит предупреждение Three.js `THREE_CJS_DEPRECATED`; оно не приводит к падению и не связано с добавленными проверками.

Отдельно `npm run lint` не запускался: в `frontend/package.json` эта команда является тем же `tsc --noEmit`, который уже выполнен как typecheck.

## Ограничения и вопросы контракта

- Vitest использует `environment: node`, а проект не подключает DOM/browser test runner. Проверка pickable запускает настоящий `onClick` handler с искусственным Three event, но не проверяет raycasting, курсор наведения, интерактивность OrbitControls или визуальное выделение в браузере.
- Реальный resize и типовые разрешения не проверены: они требуют браузерного DOM и фактического R3F/WebGL canvas. Автоматическая обработка размеров делегирована Canvas; стабильность после изменения окна остаётся предметом browser QA.
- Документы называют WASD/QE управлением камерой, но не фиксируют, должно ли оно работать только при focus самой 3D-сцены или глобально вне полей ввода. Текущий unit suite проверяет распознавание клавиш и исключение текстовых полей, но не утверждает более узкий focus-контракт.
- Текущий unit suite подтверждает mapping мыши в `CAMERA_MOUSE_BUTTONS`, но не проверяет реальные pointer drag gestures в браузере. Для подтверждения RMB rotate/LMB pan через OrbitControls нужен browser/WebGL прогон.
- Расходы и device states проверены как snapshot-derived props scene tree; численная корректность генерации snapshot остаётся за Python Simulation Core/Device Layer тестами.
