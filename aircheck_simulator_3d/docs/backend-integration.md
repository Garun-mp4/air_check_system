# Интеграция с AirCheck backend

## Используемый контракт

Simulator использует существующие REST-маршруты; новый API не добавляется.

| Метод и путь | Назначение |
|---|---|
| GET `/api/v1/measurements/latest` | доступность backend и прогноз последнего измерения |
| POST `/api/v1/measurements` | отправка indoor/outdoor telemetry |
| GET `/api/v1/controls/commands?device_id=…&limit=…` | получение ожидающих команд |
| POST `/api/v1/controls/state` | отправка actual state, ACK и heartbeat |

Backend выполняет сохранение в БД, прогноз ML и автоматику. Simulator получает прогноз из `data.prediction` ответа API и не запускает копию ML-модели.

## Выполнение команды и ACK

Network worker переносит команду в очередь событий. На главном потоке `DeviceCommandExecutor` применяет её через Device Layer. Вентилятор завершается, когда его enabled state совпал с требуемым; окно — только после фактического достижения нужного концевика и остановки мотора. Отчёт содержит actual `window_open`, `intake_on`, `exhaust_on` и `applied_command_ids`. Пока actuator движется, команда не подтверждается.

## Поток и отказоустойчивость

HTTP находится в daemon-потоке с таймаутом из `backend.toml`. Повторяются транспортные ошибки и retryable HTTP статусы с возрастающей задержкой. В offline хранится последнее telemetry snapshot, ACK остаются ожидающими, а физическая симуляция и UI продолжают работу. При восстановлении worker проверяет API, отправляет ожидающий ACK/последнюю telemetry и продолжает опрос. Некорректный JSON/API-ответ отображается как ошибка связи; он не считается подтверждением.

Параметры подключения: `backend_url`, `dashboard_url`, интервалы, timeout, retries, batch limit. `device_id` берётся из `devices.toml` или переменной `DEVICE_ID`. Dashboard открывается системным браузером по `dashboard_url`, а если URL пуст, по `backend_url`.

Пути должны совпадать с настройкой backend. В режиме разработки localhost обычно задан в `config/backend.toml`; для защиты проверьте адрес и доступность через браузер на том же компьютере.
