# AirCheck: исправление подтверждённых находок тестовой кампании

**Дата:** 2026-09-28

**База:** итоговая кампания из 14 отчётов `docs/testing/reports/01-...14-...md`

**Режим:** исправления первопричин; тесты не пропускались и не ослаблялись.

## Сверка и результат

| Находка | Контракт / причина | Исправление | Проверка |
|---|---|---|---|
| Параллельные одинаковые команды создавали несколько pending-строк | `MemoryRepository` дедуплицировал последовательные запросы, но `PostgresRepository` читал очередь и вставлял без синхронизации | Транзакция блокирует строку `actuator_states` узла через `SELECT ... FOR UPDATE` до чтения desired/pending. Контракт дедупликации добавлен в `docs/api.md` и `docs/ТЗ-поправка-03-climate-control.md` | PostgreSQL suite: 41 passed; включает конкурентный барьерный тест |
| Нормализованный `returnTo` мог стать `//outside.example/path` | проверялся только исходный путь, а `URL` нормализует `/..//outside.example/path` | после парсинга проверяется нормализованный pathname; небезопасный путь возвращает `/`. Правило зафиксировано в `docs/web-simulator.md` | auth suite: 73 passed; security тест проверяет обход нормализацией |
| Сервер применял ACK при расхождении desired/actual | `docs/api.md` требовал совпадения target-specific boolean, но оба repository implementation подтверждали только по ID/узлу/status | in-memory и PostgreSQL реализации применяют команду только при совпадении `desired_state` с reported полем нужной цели | Vitest controls suite: 42 passed; PostgreSQL integration подтверждает matching/mismatching для окна и обоих вентиляторов; Compose E2E: 4 passed |
| Ошибка загрузки списка владельца выглядела как пустой список | UI строил empty state по пустому массиву даже после неуспешного запроса | загрузка, ошибка и успешный empty state разделены; сообщение об ошибке объявляется и содержит retry. Поведение описано в `docs/web-simulator.md` | UI suite: 50 passed; включает отказ запроса и успешную повторную загрузку |
| Старый тест утверждал, что ACK ID достаточно независимо от actual | тест противоречил `docs/api.md` и бизнес-контракту | тест не удалён: ожидание исправлено на подтверждение только команды, совпавшей с reported state; unmatched-команда проверяется как pending | controls suite проходит; остальные ACK регрессии сохранены |

## Полная проверка

Проверки выполнялись на отдельном worktree `codex/fix/confirmed-findings` от проверенного `main`. Временные E2E/PostgreSQL ресурсы были изолированы.

| Проверка | Результат |
|---|---:|
| Python suite `python -m pytest -q` | 262 passed, 0 failed, 4 opt-in E2E skipped |
| PostgreSQL repository/migration suite `python -m pytest tests/database -q` | 41 passed, 0 failed, 0 skipped |
| Opt-in Compose E2E | 4 passed, 0 failed, 0 skipped |
| Frontend Vitest | 37 files, 292 passed, 0 failed |
| Целевой controls/ACK набор | 42 passed, 0 failed, 0 skipped |
| Целевой auth набор | 73 passed, 0 failed, 0 skipped |
| Целевой UI набор | 50 passed, 0 failed, 0 skipped |
| `npm run typecheck` | passed |
| `npm run lint` | passed (скрипт проекта вызывает `tsc --noEmit`) |
| `npm run build` | passed; Next.js production build создал все страницы/API routes |
| `git diff --check` | passed |

Compose E2E запускался с уникальным временным проектом, синтетическими секретами и собственными временными volumes. После завершения проверено: `0` оставшихся контейнеров `aircheck-e2e-*`, `0` таких volumes и `0` database test containers. Существующие Compose volumes и реальные данные не затрагивались. Docker cache не очищался.

## Оставшиеся ограничения

- Npm audit сообщает о двух moderate advisory для dev-зависимостей `vitest` и `@vitest/mocker` (текущая версия в advisory диапазоне); `npm audit --omit=dev --audit-level=moderate` вернул `found 0 vulnerabilities`. Автоматическое исправление предлагает Vitest 5.0.2, то есть major-переход. Пакеты и lock-файл не менялись, поскольку обновление тестового runner не нужно для четырёх исправлений и требует отдельной совместимой миграции.
- Better Auth интеграция с реальным PostgreSQL и выдачей cookie по-прежнему тестируется через boundary doubles; Compose E2E не покрывает пользовательский login/browser session flow.
- UI-тесты используют jsdom. Полноценная браузерная проверка реального WebGL, raycasting/pointer gestures, адаптивной геометрии и TLS/LAN не проводилась. Compose-проверка страницы подтверждает HTTP HTML response, не визуальные пиксели.
- Точность физической/ML-модели не калибровалась на датчиках; test campaign подтверждает контракты, устойчивость и направление поведения.

Результаты подтверждают прохождение перечисленных проверок и исправление известных красных тестов. Они не доказывают отсутствие любых иных ошибок за пределами данного тестового охвата.
