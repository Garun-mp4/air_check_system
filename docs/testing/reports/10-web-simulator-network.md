# Блок 10 — headless simulator, внутренний API и lease

## Границы

Проверены Python networking adapter/worker, lease, внутренний FastAPI service и Next.js proxy-маршруты `/api/simulator/*`. Backend, PostgreSQL, Docker Compose и production runtime заменены тестовыми doubles; реальная физическая модель проверялась только через границу координатора: её тики продолжаются при offline backend. Device Layer и физические уравнения отдельно не тестировались.

Изменены только тестовые файлы и этот отчёт. Networking, API, lifecycle, lease implementation, конфигурация, Compose и firmware не менялись.

## Добавленные проверки

- `aircheck_simulator_3d/tests/test_web_network_boundaries.py` — 17 проверок: точные JSON payload измерения и actual state/ACK на REST границе, bearer device token и request timeout; повтор HTTP 503 и отсутствие повтора HTTP 400; продолжение тиков при offline backend; остановка worker во время retry backoff и запрет повторного старта после закрытия; lease conflict между процессами для одного `DEVICE_ID`; SSE `id/event/data`, schema и порядок revision без повтора неизменившегося снимка; отклонение неверного internal token; schema и авторизация debug action.
- `frontend/src/server/simulator.test.ts` — 5 проверок настройки proxy, передачи внутреннего bearer token, SSE `Accept`, caller abort signal и offline/error mapping.
- `frontend/src/app/api/simulator/simulator-routes.test.ts` — 9 проверок same-origin/operator gate вызовов, action schema и forwarding, upstream validation error, SSE pass-through/cancellation и ошибки upstream.
- `frontend/src/app/api/simulator/simulator-authorization.test.ts` — 8 проверок реальных access helpers с подменёнными session/role store: guest, user, истёкший operator, operator, owner и forged origin для scenario/debug действий.

Уже существующие проверки в `test_networking.py`, `test_contracts.py`, `test_web_service.py` и `test_process_lease.py` сохранены; среди них timeout, offline reconnect, неблокирующая публикация telemetry, базовая SSE shape и локальный lease conflict.

## Запуски и результаты

Команды запускались из корня репозитория, если не указана другая рабочая папка.

| Команда | Результат |
|---|---:|
| `python -m pytest aircheck_simulator_3d/tests/test_web_network_boundaries.py -q` | 17 passed, 0 failed, 0 skipped |
| `python -m pytest aircheck_simulator_3d/tests -q` | 91 passed, 0 failed, 0 skipped |
| `npm test -- src/app/api/simulator/simulator-routes.test.ts src/app/api/simulator/simulator-authorization.test.ts src/server/simulator.test.ts` из `frontend/` | 22 passed, 0 failed, 0 skipped |
| `npm test` из `frontend/` | 114 passed, 0 failed, 0 skipped |
| `npm run typecheck` из `frontend/` | passed (`tsc --noEmit`) |
| `git diff --cached --check` | passed |

## Среда

Windows; Python 3.12.10, pytest 8.3.5, FastAPI 0.141.1, Pydantic 2.13.5, httpx 0.28.1; Node.js 22.22.2, npm 10.9.7, Vitest 3.2.7. Использованы существующие зависимости; установка пакетов не выполнялась.

## Дефекты и ограничения

Подтверждённых дефектов в проверенных границах не обнаружено. Все запущенные целевые тесты прошли. Внешний backend, БД и Compose не запускались; выводы о поведении полного deployment из этих unit/boundary tests не делаются.

Документация описывает SSE как поток snapshot при изменении состояния, но отдельно не задаёт семантику `id`, replay после reconnect или heartbeat. Тест фиксирует текущую реализацию: `id` равен revision, event называется `snapshot`, повтор неизменившейся revision не отправляется. **Вопрос по спецификации:** должны ли клиенты полагаться на эти правила при reconnect, и требуется ли replay/heartbeat контракт?
