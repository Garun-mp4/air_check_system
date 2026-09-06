# Sensor simulator

simulator.py имитирует будущую ESP32 и отправляет данные на единый endpoint:

~~~text
POST {BACKEND_URL}/api/v1/measurements
Content-Type: application/json
~~~

Payload содержит timestamp, вложенные indoor и outdoor, а также window_open. Формат совпадает с контрактом реального устройства.

В live-режиме simulator дополнительно работает как исполнитель команд климатического контура:

1. получает pending-команды через `GET /api/v1/controls/commands?device_id=...`;
2. применяет независимые состояния вытяжки и фильтрованного притока, а также состояние окна;
3. отправляет measurement с актуальным `window_open`;
4. подтверждает состояния через `POST /api/v1/controls/state` и передаёт `applied_command_ids`.

Это тот же REST/JSON-контракт, который в дальнейшем должна использовать прошивка ESP32. Вытяжка и приток могут работать одновременно.

## Запуск

~~~powershell
python simulator.py --mode backfill --points 480 --interval 30 --scenario normal
python simulator.py --mode live --scenario closed
python simulator.py --mode live --scenario open
~~~

Переменные BACKEND_URL, SIMULATOR_INTERVAL_SECONDS, SCENARIO, INITIAL_CO2, RANDOM_SEED, retry-параметры и параметры backfill задаются через окружение. По умолчанию backend работает на http://localhost:3000.

`DEVICE_ID` задаёт идентификатор комнаты/узла и должен совпадать с `DEVICE_ID` backend. В режиме `live` команды, отправленные из панели, будут видны в логах simulator. Если backend или устройство недоступны, команды остаются pending до следующего успешного цикла.

Сценарии normal, closed, open, surge, ventilate и outdoor_bad воспроизводимы при одинаковом RANDOM_SEED. При временной недоступности backend simulator повторяет отправку с exponential backoff и корректно завершает live-цикл по Ctrl+C.
