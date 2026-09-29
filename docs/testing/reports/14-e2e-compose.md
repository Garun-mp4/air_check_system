# Блок 14 — сквозная интеграция, Compose-профили и регрессия

**Статус:** проверка выполнена; добавлены только тесты и этот отчёт.
**Ветка:** `codex/tests/14-e2e-compose`.
**Проверено:** 28 сентября 2026 года.

## Что проверялось

В проекте уже были раздельные контракты backend и simulator: POST `/api/v1/measurements`, GET `/api/v1/prediction/latest`, очередь `/api/v1/controls/commands`, подтверждение actual state через `/api/v1/controls/state`; headless simulator предоставляет защищённые `/v1/state` и `/v1/actions`. В Compose legacy simulator находится под профилем `demo`, headless входит в стандартный стек; оба используют project-scoped volume блокировки одного `DEVICE_ID`.

Для E2E использован именно существующий backend REST API. Координатор/Device Layer исполнял команды, а backend принимал телеметрию и ACK. Код приложения, API, Compose-файл, миграции и общий pytest-конфиг не менялись.

## Добавленные E2E-тесты

Файл: `tests/integration/test_compose_e2e.py`.

| Тест | Проверяемый контракт |
|---|---|
| `test_web_demo_publishes_telemetry_and_real_ml_forecast` | Headless simulator отправляет новую telemetry; backend сохраняет её; отдельный ML-service обучается на данных временной БД и выдаёт настоящий forecast; прогноз доходит до snapshot simulator; dashboard HTTP entry point отвечает HTML. |
| `test_simulated_critical_co2_drives_actuators_and_ack` | Сценарий `co2_buildup` создаёт критический CO₂ в физической модели. Backend автоматики ставит команды; simulator исполняет их; окно доходит до open limit, вентиляторы включаются, backend показывает `reported == desired`, `pending_commands = 0` и `last_command.status = applied`; после включения вентиляции CO₂ в модели снижается. |
| `test_backend_offline_and_reconnect_preserve_running_simulation` | При остановке backend headless simulator продолжает работать и сообщает offline; после запуска backend соединение восстанавливается, а API снова содержит свежие измерения. |
| `test_legacy_simulator_cannot_acquire_web_demo_device_lease` | Пока headless simulator владеет устройством, одноразовый запуск legacy simulator с тем же `DEVICE_ID` завершается сообщением общей блокировки `already served by another simulator process`. |

E2E suite по умолчанию помечен `skipif`. Docker запускается только при явном `AIRCHECK_RUN_COMPOSE_E2E=1`; ни обычный pytest, ни сборка других тестовых блоков не поднимают Compose автоматически.

## Изоляция и окружение

- Windows, Python 3.12.10, pytest 8.3.5, Docker Engine 29.6.1, Docker Compose 5.1.4.
- Успешный прогон использовал уникальный project name `aircheck-e2e-a1ad4203b2` и стандартный набор сервисов с зависимостями PostgreSQL, ML и backend. Caddy и `owner-cli` не запускались.
- Backend и simulator публиковались на случайные свободные порты, привязанные только к `127.0.0.1`. Опубликованные порты PostgreSQL и ML-service временно отключались override-файлом.
- Внешний временный env-файл содержал случайные синтетические database/auth/device/service credentials. Для обучения передано 70 тестовых измерений через REST в БД этого Compose-проекта; ML-service обучался существующим `ml-service/train.py` и записывал модель в отдельный project-scoped volume.
- Старый simulator запускался только как короткая проверка отказа lease, а не как второй работающий источник. Профиль `maintenance` не запускался.
- После прогона выполнен `docker compose down --volumes --remove-orphans --rmi local` с тем же точным project name. Проверено отсутствие его контейнеров, volumes, networks, локальных образов и временных env-файлов. Существующие контейнеры и volumes других проектов не трогались; глобальный Docker/BuildKit cache не очищался. После очистки на `C:` оставалось около 13.04 GiB свободно, порог 7 GiB не достигался.

## Команды и результаты

Команды выполнены из корня репозитория на указанной ветке.

```powershell
python -m py_compile tests/integration/test_compose_e2e.py
python -m pytest -q tests/integration
$env:AIRCHECK_RUN_COMPOSE_E2E = '1'
python -m pytest -vv -s tests/integration/test_compose_e2e.py
python -m pytest -q
python -m pytest -q -o "testpaths=ml-service/tests sensor-simulator aircheck_simulator_3d/tests tests"
git diff --check
```

| Набор | Итог |
|---|---:|
| Компиляция нового тестового модуля | passed |
| Обычный запуск `tests/integration` без opt-in | 0 passed / 0 failed / 4 skipped |
| Фактический Compose E2E с opt-in | 4 passed / 0 failed / 0 skipped за 127.13 с |
| Настроенный существующий Python suite (`python -m pytest -q`) | 98 passed / 0 failed / 0 skipped за 22.08 с |
| Существующий Python suite плюс корневая папка `tests/` | 98 passed / 0 failed / 4 skipped за 19.89 с |
| `git diff --check` | passed |

В этом checkout `pytest.ini` пока не включает корневую `tests/` в обычный `testpaths`; общий конфиг оставлен без изменений по условиям блока. Команда с `-o testpaths=... tests` подтвердила, что после включения корневой папки E2E-тесты обнаруживаются, но пропускаются без opt-in.

## Результат и границы проверки

В opt-in прогоне настоящие Compose-сервисы обменивались данными: simulator → backend/PostgreSQL → ML forecast; автоматический контур создал команды; Device Layer завершил виртуальное движение и включение вентиляторов; backend зафиксировал actual state и статус ACK как `applied`. Offline/reconnect и защита от одновременного legacy/headless источника также прошли.

Проверка dashboard ограничена HTTP-ответом настоящей страницы Next.js (`200`, `text/html`, содержимое `AirCheck`); браузерный визуальный рендеринг здесь не тестировался. Caddy/TLS/LAN-маршрутизация не проверялись, потому что задача была проверить внутренний E2E маршрут стандартного веб-стека, а Caddy в Compose запускается отдельно как общий сервис. Модель проверялась на факте обучения, загрузки и выдачи forecast; точность ML на синтетической постоянной истории не оценивалась.

Исходный прогон проверял одну последовательную автоматическую партию команд. Он не являлся проверкой одновременного enqueue/dedup; на тот момент риск оставался открытым. Текущее состояние после отдельного исправления и повторной проверки указано ниже.

**Итог блока 14:** E2E-сценарий стандартного веб-стека, offline/reconnect и эксклюзивность источника проверены. Suite не меняет production/Compose конфигурацию.

## Повторный прогон после remediation

**2026-09-28:** весь opt-in E2E-набор повторно выполнен на отдельной ветке исправлений после фикса ACK и конкурентной очереди: **4 passed, 0 failed, 0 skipped за 199.48 с**. Тестовый проект создавал уникальные `device_id`, Compose project name, credentials и volumes; dashboard и services были доступны только через loopback. После выхода pytest проверено, что контейнеров, volumes с префиксом `aircheck-e2e-` и временных database test containers не осталось. Постоянные Compose-проекты и volumes не менялись.

Повторный сценарий `test_simulated_critical_co2_drives_actuators_and_ack` подтвердил цепочку backend automation → virtual actuators → фактическое состояние → ACK. Конкурентный enqueue проверяется отдельным PostgreSQL тестом из блока 02.
