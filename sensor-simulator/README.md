# Sensor simulator

simulator.py имитирует будущую ESP32 и отправляет данные на единый endpoint:

~~~text
POST {BACKEND_URL}/api/v1/measurements
Content-Type: application/json
~~~

Payload содержит timestamp, вложенные indoor и outdoor, а также window_open. Формат совпадает с контрактом реального устройства.

## Запуск

~~~powershell
python simulator.py --mode backfill --points 480 --interval 30 --scenario normal
python simulator.py --mode live --scenario closed
python simulator.py --mode live --scenario open
~~~

Переменные BACKEND_URL, SIMULATOR_INTERVAL_SECONDS, SCENARIO, INITIAL_CO2, RANDOM_SEED, retry-параметры и параметры backfill задаются через окружение. По умолчанию backend работает на http://localhost:3000.

Сценарии normal, closed, open, surge, ventilate и outdoor_bad воспроизводимы при одинаковом RANDOM_SEED. При временной недоступности backend simulator повторяет отправку с exponential backoff и корректно завершает live-цикл по Ctrl+C.
