# AirCheck

AirCheck — локальная панель управления качеством воздуха для одной комнаты. Система принимает показания с simulator или будущего ESP32, сохраняет их в PostgreSQL, строит прогноз CO₂ на 15 минут, предлагает действие и управляет климатическим контуром помещения.

Проект рассчитан на одного владельца локальной установки, поэтому frontend является операционной панелью управления, а не коммерческим landing page. На экране доступны реальные показания, состояние вытяжки и притока, состояние окна, автоматический режим, ручные команды и история.

## Возможности

- текущие indoor/outdoor показатели: CO₂, температура, влажность и PM2.5;
- прогноз CO₂ на 15 минут через реальный Python/scikit-learn ML-сервис;
- rule-based рекомендация по проветриванию;
- отдельное состояние вытяжки и притока;
- одновременный запуск вытяжки и притока одной автоматической batch-командой;
- ручное включение/выключение вытяжки и притока из панели;
- окно с режимами «Авто», «Открыть» и «Закрыть»;
- защита от немедленного вмешательства автоматики после ручной команды окна;
- очередь команд с различием между желаемым и подтверждённым состоянием;
- polling simulator, который использует тот же контракт, что и будущая ESP32;
- отдельная панель настроек с техническими сведениями и правилами автоматики;
- ручное обновление показаний прямо в карточке «Воздух в комнате» с отметкой времени последней синхронизации;
- пространственная схема «снаружи ⇄ окно ⇄ внутри комнаты» с переходом к соответствующей группе датчиков;
- интерактивные графики CO₂ и температуры за 6 часов, 24 часа или 7 дней;
- панорамирование графика, Ctrl + колесо и pinch-to-zoom, а также кнопки просмотра и масштаба для клавиатуры и touch-устройств;
- компактная история состояния окна в карточке управления вместо отдельной непонятной полосы;
- loading, empty, error и waiting-for-device состояния;
- mobile-first интерфейс на React, соответствующий `DESIGN-cal.md`.

## Архитектура

```text
Python simulator / будущая ESP32
        │  REST/JSON: measurements + control state
        ▼
Next.js TypeScript server
  ├─ React dashboard
  ├─ REST API route handlers
  ├─ Recommendation Engine
  └─ очередь команд климатического контура
        │                         │
        ▼                         ▼
 PostgreSQL 16              Python ML service
 measurements                scikit-learn
 predictions                 train / predict
 recommendations
 actuator_states
 actuator_commands
```

### Стек

- TypeScript 5 + Next.js 15 server runtime;
- React 19 + TypeScript;
- PostgreSQL 16;
- Python 3.12 + scikit-learn;
- simulator на Python с `urllib`, без отдельного формата данных;
- Docker Compose для локального запуска;
- CSS tokens/components из `DESIGN-cal.md`.

Изменения стека, формата интерфейса и климатического контура зафиксированы в [поправке к стеку](docs/ТЗ-поправка-01-стек.md), [поправке про AirCheck-панель](docs/ТЗ-поправка-02-aircheck-panel.md) и [поправке про климатический контур](docs/ТЗ-поправка-03-climate-control.md).

Аудит визуальных признаков AI-slop и принятые решения по интерфейсу собраны в [docs/ai-slop-audit.md](docs/ai-slop-audit.md).

## Быстрый запуск через Docker

Требуется Docker Desktop с работающим Docker Engine.

```powershell
Copy-Item .env.example .env
docker compose build
docker compose up -d postgres ml-service backend
```

Проверить состояние контейнеров:

```powershell
docker compose ps
curl.exe http://localhost:3000/healthz
curl.exe http://localhost:8000/healthz
```

Ожидается `postgres ... healthy`, а backend и ML-service должны иметь статус `Up`.

### Заполнение истории и обучение модели

До первой тренировки модели нужно создать историю. Backfill отправляет данные в тот же endpoint, который будет использовать ESP32:

```powershell
docker compose --profile demo run --rm simulator --mode backfill --points 480 --interval 30 --scenario normal
docker compose run --rm --no-deps --entrypoint python ml-service train.py `
  --source-url "http://backend:3000/api/v1/measurements/history?limit=1000" `
  --output-dir /app/model `
  --dataset-output /app/data/training_dataset.csv
docker compose restart ml-service
```

После успешного обучения ML-service возвращает `model.status = ready`. Модель не подменяется формулой вроде `current_co2 + 100`: training pipeline готовит признаки, делает временное разделение train/test, сравнивает Linear Regression и Random Forest, считает MAE/RMSE и сохраняет выбранную модель в Docker volume.

### Live simulator

Для постоянной демонстрации запустите источник данных:

```powershell
docker compose --profile demo up -d simulator
docker compose logs -f simulator
```

В интерфейсе откройте [http://localhost:3000](http://localhost:3000). Simulator каждые 30 секунд:

1. получает ожидающие команды для `room-01`;
2. применяет их к своим состояниям вытяжки, притока и окна;
3. отправляет measurement;
4. отправляет подтверждённое control state обратно на сервер.

Остановка demo-контейнера:

```powershell
docker compose stop simulator
```

Полная остановка стека:

```powershell
docker compose --profile demo down
```

Команда `down` удаляет контейнеры и сеть, но не удаляет именованные volumes PostgreSQL и ML-модели.

## Бизнес-логика климатического контура

Сервер различает два состояния:

- `reported` — последнее состояние, которое подтвердил simulator/ESP32;
- `desired` — состояние, которое сервер попросил установить.

Если они отличаются, панель показывает ожидание устройства. Команда считается выполненной только после `POST /api/v1/controls/state` с соответствующим `applied_command_ids` и совпадающим фактическим boolean-состоянием. Если устройство сообщает несовпадение, команда остаётся pending и будет повторно предложена узлу.

### Вытяжка и приток

Вытяжка и приток являются независимыми каналами. Каждый можно включить или выключить вручную. Они не блокируют друг друга и могут работать одновременно: это штатный режим проветривания, в котором старый воздух выводится, а новый подаётся через фильтр.

Ручное включение канала считается явным намерением оператора и не отменяется нормальным измерением. Автоматика выключает канал после восстановления показателей только если его последняя команда включения была автоматической.

### Автоматическое окно

Режим окна по умолчанию — `auto`.

- Если текущий CO₂ или прогноз на 15 минут достигает критического порога, автоматика создаёт одну batch-группу из трёх команд: открыть окно, включить вытяжку, включить приток.
- Если окно уже открыто и CO₂ выше комфортного порога, оба воздушных канала поддерживают проветривание.
- Если CO₂ и прогноз вернулись ниже комфортного порога и прошло минимум 5 минут проветривания, автоматика создаёт batch-группу на закрытие окна и выключение обоих каналов.
- Ручная команда «Открыть» или «Закрыть» переводит окно в `manual` на 30 минут. В этот период автоматика не перетирает решение пользователя.
- Кнопка «Авто» снимает ручную блокировку; дальнейшее решение принимает следующий цикл измерения.
- Если устройство недоступно, команда остаётся `pending`, а интерфейс явно показывает ожидание. Сервер не сообщает «выполнено» заранее.

Пороговые значения и длительности вынесены в `.env`: `CO2_NORMAL_THRESHOLD`, `CO2_CRITICAL_THRESHOLD`, `WINDOW_MANUAL_OVERRIDE_MINUTES`, `AUTO_VENTILATION_MINIMUM_MINUTES`.

## REST API

Все route handlers находятся в `frontend/src/app/api/v1`.

### Показания

`POST /api/v1/measurements` принимает единый ESP32-compatible payload:

```json
{
  "timestamp": "2026-09-06T10:00:00Z",
  "indoor": {
    "co2": 720,
    "temperature": 23.4,
    "humidity": 45,
    "pm25": 5.2
  },
  "outdoor": {
    "temperature": 18,
    "humidity": 60,
    "pm25": 8
  },
  "window_open": false
}
```

`GET /api/v1/measurements/latest` возвращает последнее измерение, прогноз и рекомендацию.

`GET /api/v1/measurements/history?from=&to=&limit=` возвращает исторический ряд в порядке времени. `limit` — от 1 до 1000.

`GET /api/v1/prediction/latest` и `GET /api/v1/recommendation` возвращают последние ML-прогноз и рекомендацию.

### Управление

`GET /api/v1/controls?device_id=room-01` возвращает фактическое и желаемое состояние:

```json
{
  "data": {
    "device_id": "room-01",
    "connection": {
      "status": "online",
      "last_seen_at": "2026-09-06T10:00:00Z"
    },
    "reported": {
      "exhaust_on": false,
      "intake_on": false,
      "window_open": false
    },
    "desired": {
      "exhaust_on": true,
      "intake_on": true,
      "window_open": true
    },
    "window": {
      "mode": "auto",
      "override_until": null,
      "open_since": null
    },
    "automation": {
      "enabled": true,
      "status": "waiting_for_device",
      "message": "Команда ожидает подтверждения локального узла."
    },
    "pending_commands": 3,
    "last_command": null,
    "updated_at": "2026-09-06T10:00:00Z"
  }
}
```

`POST /api/v1/controls/commands` — ручная команда из приложения:

```json
{"device_id":"room-01","target":"exhaust","action":"on"}
```

Допустимые значения:

- `target=exhaust`, `action=on|off`;
- `target=intake`, `action=on|off`;
- `target=window`, `action=open|close|auto`.

Для новой команды сервер возвращает `202 Accepted`. Для `window:auto`, если команда устройству не нужна, возвращается `200`. Ответ содержит созданные команды и актуальный control status.

`GET /api/v1/controls/commands?device_id=room-01&limit=20` — очередь pending-команд для simulator/ESP32.

`POST /api/v1/controls/state` — подтверждение от устройства:

```json
{
  "device_id": "room-01",
  "timestamp": "2026-09-06T10:00:00Z",
  "exhaust_on": true,
  "intake_on": true,
  "window_open": true,
  "applied_command_ids": [101, 102, 103]
}
```

Валидация всех входных payload единообразна. Ошибки имеют форму:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Проверьте данные запроса",
    "fields": [{"field": "target", "message": "..."}]
  }
}
```

Полная таблица API находится в [docs/api.md](docs/api.md).

## Интерфейс

Главный экран панели состоит из рабочих секций:

1. **Панель** — текущий CO₂, 15-минутный прогноз, рекомендация и состояние локального узла.
2. **Управление** — вытяжка, приток, окно и состояние команд.
3. **Сенсоры** — пространственно разделённые показатели внутри комнаты и снаружи, PM2.5-шкалы и текущее окно.
4. **История** — реальные интерактивные графики из PostgreSQL; окно отображается рядом с командами управления, где его состояние имеет практический контекст.

Техническая информация не занимает место рядом с текущими показаниями: источник, PostgreSQL, модель прогноза и API-контракт открываются через кнопку **Настройки** в шапке. Внутри доступны вкладки «Технические сведения» и «Автоматика». Это диагностический раздел без управляющих действий; рабочие команды остаются на вкладке «Управление».

Дизайн использует только токены `DESIGN-cal.md`: белый canvas, `surface-card`/`surface-soft`, near-black primary, Inter для UI, Cal Sans substitute для display, 8/12/16px radius hierarchy, 4px spacing grid и hairline borders. Состояния используют semantic success/warning/error, а не декоративные цвета.

Responsive behavior:

- до 768px горизонтальная навигация заменяется мобильным меню;
- карточки климатического контура и графики складываются в одну колонку;
- режимы окна остаются крупными tappable controls;
- на графике одним пальцем можно перемещать временной диапазон, двумя пальцами — менять масштаб; кнопки «‹», «›», «+», «−» и «Сбросить» повторяют жесты;
- обычная прокрутка страницы не перехватывается вне области графика, а обычное колесо мыши не меняет масштаб без Ctrl;
- на desktop настройки доступны из шапки, а главный экран оставляет всё пространство текущим показаниям и действиям;
- горизонтального скролла для рабочих блоков нет.

## Переменные окружения

Основные значения находятся в [.env.example](.env.example):

| Переменная | Назначение | По умолчанию |
|---|---|---:|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | PostgreSQL | `air_quality` / `air_quality` / `air_quality_dev` |
| `DATABASE_URL` | локальное подключение TypeScript server | `postgres://...localhost...` |
| `PORT` | порт Next.js | `3000` |
| `ML_SERVICE_URL` | адрес Python ML-сервиса | `http://localhost:8000` |
| `HISTORY_LIMIT` | максимум истории API | `200` |
| `ML_HISTORY_LIMIT` | история для признаков ML | `200` |
| `CO2_NORMAL_THRESHOLD` | верхняя граница комфортной зоны | `800` |
| `CO2_CRITICAL_THRESHOLD` | порог автоматического проветривания | `1000` |
| `DEVICE_ID` | идентификатор комнаты/узла | `room-01` |
| `DEVICE_HEARTBEAT_TIMEOUT_MS` | время до статуса stale | `90000` |
| `WINDOW_MANUAL_OVERRIDE_MINUTES` | длительность ручной блокировки окна | `30` |
| `AUTO_VENTILATION_MINIMUM_MINUTES` | минимальное автоматическое проветривание | `5` |
| `AUTOMATION_ENABLED` | включить автоматическое управление | `true` |
| `SIMULATOR_MODE` | `live` или `backfill` | `live` |
| `SIMULATOR_INTERVAL_SECONDS` | период live-цикла | `30` |
| `SCENARIO` | профиль синтетических данных | `normal` |
| `INITIAL_CO2` | начальный CO₂ simulator | `650` |

Дополнительные retry/backfill параметры также описаны в `.env.example`.

## Локальная разработка без Docker

Установить Node.js 22+, npm, Python 3.12+ и запустить PostgreSQL/ML-service отдельно.

```powershell
Copy-Item .env.example .env
cd frontend
npm install
npm run dev
```

Production-проверка frontend/backend:

```powershell
cd frontend
npm run typecheck
npm test
npm run build
```

Python-проверка:

```powershell
cd ..
python -m pytest ml-service/tests sensor-simulator/test_simulator.py -q
```

Standalone frontend image собирается через `frontend/Dockerfile`. В production Next.js работает как единый standalone server: React UI и REST API доступны на порту 3000.

## Тестирование

Тесты покрывают:

- валидацию ESP32 measurement payload;
- временные признаки и отсутствие утечки будущих измерений в ML;
- нормальный, критический и прогнозируемый рост CO₂;
- рекомендации при закрытом и открытом окне;
- сохранение и сортировку данных;
- реальный ML response и отказ от фиктивного прогноза;
- очередь трёх одновременных control-команд;
- подтверждение фактического состояния от устройства;
- запрет автоматики перетирать ручной режим окна;
- математика viewport графика: ограничение диапазона, zoom вокруг точки, pan с границами ряда;
- компактная сводка переходов состояния окна при данных, пришедших не по порядку;
- simulator payload, сценарии роста/снижения CO₂, retry и live stop.

Команды проверки:

```powershell
cd frontend
npm run typecheck
npm test
npm run build
cd ..
python -m pytest ml-service/tests sensor-simulator/test_simulator.py -q
docker compose config --quiet
```

## Миграции PostgreSQL

- `database/migrations/001_init.sql` — measurements, predictions, recommendations;
- `database/migrations/002_controls.sql` — actuator states и очередь команд.

Для чистого PostgreSQL Compose применяет обе миграции при первом создании volume. Если volume уже существовал до добавления `002_controls.sql`, примените её один раз вручную:

```powershell
docker compose exec -T postgres psql -U air_quality -d air_quality -f /docker-entrypoint-initdb.d/002_controls.sql
```

Команда идемпотентна благодаря `IF NOT EXISTS`.

## Структура проекта

```text
database/migrations/                 PostgreSQL schema and controls migration
frontend/src/app/api/v1              Next.js REST route handlers
frontend/src/components              React dashboard, control panel and charts
frontend/src/lib/client-api.ts       typed browser API client
frontend/src/server                  validation, repository, ML, rules, controls
frontend/public/aircheck-logo.svg    AirCheck SVG logo
ml-service                            training and prediction service
sensor-simulator                      ESP32-compatible data/control simulator
docs/api.md                           REST contract
docs/ml.md                            ML pipeline notes
docs/ТЗ-поправка-*.md                 project amendments
```

## Ограничения текущего этапа

- физическая ESP32 и реальные датчики ещё не подключены;
- simulator — источник тестовых данных, но его measurement/control API совпадает с будущей ESP32;
- автоматическое управление рассчитано на локальную доверенную сеть и пока не содержит авторизацию;
- внешний фильтр, моторы и механизм окна физически не управляются до подключения устройства;
- при выключенном simulator команды остаются в очереди и отображаются как ожидающие подтверждения.
