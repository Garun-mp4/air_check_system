# AirCheck

AirCheck — локальная система мониторинга качества воздуха в помещении. Она принимает показания в ESP32-совместимом REST/JSON формате, сохраняет их в PostgreSQL, прогнозирует CO₂ на 15 минут вперёд и формирует рекомендацию по проветриванию.

## Актуальный стек

- TypeScript + Next.js: сервер и REST API через server route handlers;
- React + TypeScript: dashboard в том же Next.js-приложении;
- PostgreSQL 16: измерения, прогнозы и рекомендации;
- Python 3.12 + scikit-learn: обучение Linear Regression и Random Forest Regressor;
- Python simulator: синтетический источник данных с тем же контрактом, что и будущая ESP32;
- CSS-токены и компоненты — по DESIGN-cal.md.

Изменения стека и формата интерфейса зафиксированы в поправках к ТЗ (`docs/ТЗ-поправка-01-стек.md`, `docs/ТЗ-поправка-02-aircheck-panel.md`) и в приложенном исходном ТЗ.

## Запуск через Docker Compose

Требуется Docker Desktop с запущенным Docker Engine.

~~~powershell
Copy-Item .env.example .env
docker compose up -d postgres ml-service backend
docker compose --profile demo run --rm simulator --mode backfill --points 480 --interval 30
docker compose run --rm --no-deps --entrypoint python ml-service train.py --source-url "http://backend:3000/api/v1/measurements/history?limit=1000" --output-dir /app/model
docker compose restart ml-service
docker compose --profile demo up simulator
~~~

После запуска dashboard доступен по адресу http://localhost:3000. Для остановки live simulator нажмите Ctrl+C, затем выполните docker compose --profile demo down.

Первый backfill создаёт исторические данные для подготовки признаков. Модель появляется после команды обучения; до этого API честно возвращает статус insufficient_history или unavailable, не подставляя фиктивный прогноз.

## Режимы simulator

~~~powershell
docker compose --profile demo run --rm -e SCENARIO=normal simulator --mode live
docker compose --profile demo run --rm -e SCENARIO=closed simulator --mode live
docker compose --profile demo run --rm -e SCENARIO=open simulator --mode live
~~~

Поддерживаются также surge, ventilate и outdoor_bad. Параметры интервала, seed, количества точек и retry задаются через .env.

## API

Основные endpoints:

- POST /api/v1/measurements — принимает вложенный payload timestamp, indoor, outdoor, window_open;
- GET /api/v1/measurements/latest — последнее измерение с последним прогнозом и рекомендацией;
- GET /api/v1/measurements/history?from=&to=&limit= — исторический ряд в порядке времени;
- GET /api/v1/prediction/latest — последний сохранённый прогноз;
- GET /api/v1/recommendation — последняя рекомендация;
- GET /healthz — проверка приложения и соединения с PostgreSQL.

Пример запроса источника данных:

~~~powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/v1/measurements -ContentType 'application/json' -Body '{"timestamp":"2026-09-06T10:00:00Z","indoor":{"co2":720,"temperature":23.4,"humidity":45,"pm25":5.2},"outdoor":{"temperature":18,"humidity":60,"pm25":8},"window_open":false}'
~~~

Сервер отвечает единым форматом ошибки:

~~~json
{"error":{"code":"validation_error","message":"Проверьте данные запроса","fields":[{"field":"indoor.co2","message":"..."}]}}
~~~

Полное описание контракта находится в docs/api.md.

## Локальная разработка

~~~powershell
cd frontend
npm install
npm run dev
~~~

Для production-проверки:

~~~powershell
npm run typecheck
npm test
npm run build
~~~

Python-тесты:

~~~powershell
python -m pytest ml-service/tests sensor-simulator/test_simulator.py -q
~~~

Для обучения из локального JSON:

~~~powershell
python ml-service/train.py --input-file history.json --output-dir ml-service/model --dataset-output ml-service/data/training_dataset.csv
~~~

## Структура

~~~text
database/migrations/001_init.sql   PostgreSQL schema
frontend/src/app/api               Next.js REST route handlers
frontend/src/server                validation, repository, features, ML client, rules
frontend/src/components             React dashboard and SVG charts
frontend/css/styles.css             DESIGN-cal.md tokens and responsive styles
ml-service                          Python ML API and training pipeline
sensor-simulator                    ESP32-compatible synthetic source
docs                                stack amendment and API/ML notes
~~~
