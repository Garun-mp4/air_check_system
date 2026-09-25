# AirCheck 3D Simulator

Отдельное Python-приложение — фундамент цифрового двойника AirCheck. В Milestone 1 оно загружает конфигурацию,
создаёт единое начальное состояние и открывает минимальное окно Panda3D. Геометрия стенда, физика воздуха и реальный
сетевой обмен добавляются в следующих этапах.

## Запуск в Windows PowerShell

Из корня репозитория:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r aircheck_simulator_3d/requirements.txt
.\.venv\Scripts\python.exe -m aircheck_simulator_3d
```

Для краткой проверки окна, которое закроется само:

```powershell
.\.venv\Scripts\python.exe -m aircheck_simulator_3d --smoke-test-seconds 3
```

Изменяйте параметры в `config/*.toml` или передавайте каталог со своими файлами через `--config-dir`. Backend URL,
dashboard URL и идентификатор устройства также читаются из `BACKEND_URL`, `DASHBOARD_URL` и `DEVICE_ID`; интервал
телеметрии, timeout, retry-настройки, уровень логирования и начальные indoor CO₂/температура/влажность совместимы с
переменными окружения старого simulator (`SIMULATOR_INTERVAL_SECONDS`, `REQUEST_TIMEOUT_SECONDS`, `RETRY_ATTEMPTS`,
`RETRY_BASE_DELAY_SECONDS`, `LOG_LEVEL`, `INITIAL_CO2`, `BASE_TEMPERATURE`, `BASE_HUMIDITY`).

## Слои Milestone 1

- `simulation/` хранит централизованное состояние помещения и фиксированное продвижение simulation time независимо
  от частоты кадров; расчёты воздуха ещё не выполняются.
- `devices/` описывает виртуальный контроллер ESP32, indoor/outdoor датчики SCD41, SPS30 и SHT45, а также состояния
  окна и вентиляторов.
- `networking/` содержит DTO и точные маршруты REST AirCheck, но пока не создаёт HTTP-клиент и потоки.
- `scene/` и `ui/` отвечают только за пустое Panda3D-окно и стартовую подпись.
- `app/` загружает конфигурацию, собирает компоненты, настраивает логи и освобождает ресурсы.

Начальные значения состояния и параметры шага заданы в `config/room.toml`, `devices.toml` и `physics.toml`. Графика,
сетевые адреса и настройки логов заданы в отдельных файлах той же папки.

## Совместимость с AirCheck

Контракты в `networking/contracts.py` повторяют существующие `POST /api/v1/measurements`,
`GET /api/v1/controls/commands?device_id=...&limit=...` и `POST /api/v1/controls/state`. В measurement `window_open`
считывается с виртуального геркона; в state report записываются фактические состояния вентиляции и окна.
Прогноз CO₂ рассчитывает backend через существующий ML pipeline; приложение не дублирует прогноз или автоматику.
Настоящий обмен с backend, обработка движущихся актуаторов и ACK после их физического завершения намеренно оставлены
следующим milestones.

Backend передаёт измерения существующему ML service, сохраняет прогноз CO₂ и запускает автоматику. Он хранит
запрошенные и подтверждённые состояния устройств и отмечает команду выполненной, только когда отчёт устройства
совпадает с запрошенным состоянием; `applied_command_ids` входит в этот контракт подтверждения.

## Логи

После запуска создаются `aircheck_simulator_3d/logs/application.log`, `simulation.log` и `api.log`.
