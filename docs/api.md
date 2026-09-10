# REST/JSON API

Все endpoints TypeScript-сервера находятся в Next.js route handlers и работают относительно /api/v1.

## POST /api/v1/measurements

Входное тело:

~~~json
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
~~~

Дата должна содержать часовой пояс. Сервер проверяет типы, конечность и физически допустимые диапазоны значений, затем сохраняет запись в measurements. В ответе 201 возвращаются измерение, прогноз (если достаточно истории и ML-сервис доступен), рекомендация и prediction_status.

simulator отправляет именно это тело. Поэтому будущая ESP32 сможет заменить simulator без отдельного endpoint или преобразователя.

## GET /api/v1/measurements/latest

Ответ:

~~~json
{
  "data": {
    "measurement": {
      "id": 481,
      "created_at": "2026-09-06T10:00:00.100Z",
      "timestamp": "2026-09-06T10:00:00.000Z",
      "indoor": {"co2": 720, "temperature": 23.4, "humidity": 45, "pm25": 5.2},
      "outdoor": {"temperature": 18, "humidity": 60, "pm25": 8},
      "window_open": false
    },
    "prediction": null,
    "recommendation": null
  }
}
~~~

До первого измерения вложенные значения равны null. Это позволяет frontend показать штатное empty-state.

## Настройки узла

`GET /api/v1/settings?device_id=room-01` возвращает постоянные правила конкретного локального узла. `PATCH /api/v1/settings` обновляет одно или несколько полей:

~~~json
{
  "device_id": "room-01",
  "automation_enabled": true,
  "auto_window_enabled": true,
  "manual_override_minutes": 30,
  "auto_ventilation_minimum_minutes": 5,
  "co2_normal_threshold": 800,
  "co2_critical_threshold": 1000,
  "pm25_good_limit": 15,
  "pm25_elevated_limit": 35,
  "alerts_enabled": true
}
~~~

Сервер проверяет диапазоны и порядок порогов: критический CO₂ должен быть выше комфортного, а повышенный PM2.5 — выше нормального. Сохранённые значения применяются к автоматике, рекомендациям и шкалам показателей. `retention_hours` возвращается только для справки и не изменяется через этот endpoint.

## GET /api/v1/measurements/history

Параметры from и to — необязательные RFC3339 даты, limit — число от 1 до 5000. Ответ содержит data с измерениями в порядке возрастания времени и meta. Панель использует периоды 30 минут, 1 час, 6 часов и 24 часа.

## GET /api/v1/prediction/latest и GET /api/v1/recommendation

Возвращают { "data": ... }. До появления записи data равен null.

## Управление климатическим контуром

Управление рассчитано на одну локальную комнату и один узел, идентификатор которого задаётся `DEVICE_ID`. Сервер хранит два представления состояния:

- `reported` — последнее подтверждение от simulator/ESP32;
- `desired` — состояние, которое сервер ожидает от узла.

Пока эти состояния различаются, команда остаётся pending и frontend показывает ожидание устройства.

### GET /api/v1/controls

Возвращает актуальное состояние климатического контура. Необязательный параметр `device_id` позволяет явно выбрать узел.

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

`connection.status` имеет значения `online`, `stale` или `offline`. Состояние окна дополнительно содержит `mode`: `auto` или `manual`.

### POST /api/v1/controls/commands

Создаёт ручную команду для узла. Тело запроса:

```json
{
  "device_id": "room-01",
  "target": "exhaust",
  "action": "on"
}
```

Допустимые комбинации:

- `target=exhaust`, `action=on|off` — вытяжка;
- `target=intake`, `action=on|off` — фильтрованный приток;
- `target=window`, `action=open|close|auto` — окно и снятие ручной блокировки.

Команды `exhaust` и `intake` независимы и могут быть включены одновременно. Для открытия/закрытия окна создаётся временная ручная блокировка на `WINDOW_MANUAL_OVERRIDE_MINUTES`; `auto` возвращает окно под контроль автоматики. Ответ на новую команду — `202 Accepted`, а для `window:auto` без изменения состояния — `200`.

### GET /api/v1/controls/commands

Возвращает pending-команды для simulator/ESP32:

```text
GET /api/v1/controls/commands?device_id=room-01&limit=20
```

Команды отсортированы по времени создания. В каждой записи есть `id`, `target`, `desired_state`, `source`, `reason`, `batch_id`, `status` и timestamps. Автоматическое открытие окна, включение вытяжки и включение притока объединяются одним `batch_id`.

### POST /api/v1/controls/state

Узел подтверждает фактические состояния одним запросом:

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

Сервер обновляет `reported`, сохраняет время последнего подтверждения и отмечает перечисленную pending-команду как `applied` только если её `desired_state` совпадает с соответствующим boolean-полем отчёта. При несовпадении команда остаётся pending для повторной синхронизации. Simulator и будущая ESP32 используют один и тот же контракт.

## Ошибки

~~~json
{
  "error": {
    "code": "validation_error",
    "message": "Проверьте данные запроса",
    "fields": [
      {"field": "window_open", "message": "должно быть boolean"}
    ]
  }
}
~~~

Ошибки базы и внешнего сервиса не раскрывают внутренние детали SQL. Ошибка ML-прогноза не отменяет сохранение измерения.
