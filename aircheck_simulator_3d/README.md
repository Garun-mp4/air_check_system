# Python Simulation Core AirCheck

Этот пакет содержит физическую модель комнаты, Device Layer и headless-сервис для браузерного 3D-стенда. Сцена, камера, HUD и управление находятся в `frontend/src/components/simulator`.

## Запуск

Из корня репозитория запустите веб-стек:

```powershell
docker compose up --build -d
docker compose ps
```

Откройте `https://aircheck.home.arpa/simulator`. Контейнер `web-simulator` запускает `SimulationCoordinator`, публикует состояние через внутренний API/SSE и использует тот же REST-контракт backend для telemetry, команд и ACK.

## Слои

- `simulation/` — детерминированная однозонная модель и фиксированный шаг 0,1 с;
- `devices/` — виртуальные датчики, оконный привод, концевики и вентиляторы;
- `app/coordinator.py` — единая координация среды, устройств, сценариев и backend;
- `networking/` — AirCheck REST-контракт, защищённый внутренний API и SSE;
- `app/stand_layout.py` — общие размеры стенда и координаты настенного оборудования, используемые Python и браузерной сценой;
- `frontend/src/components/simulator/scene/` — Three.js-модели помещения, приборов, проводки, airflow и камера.

Браузер отображает снимок модели и отправляет разрешённые действия через Next.js. Он не пересчитывает физику и не подменяет actual state устройств.

## Проверки

Python-тесты запускаются из корня репозитория:

```powershell
python -m pytest aircheck_simulator_3d/tests -q
```

Тесты фронтенда и production build:

```powershell
cd frontend
npm test
npm run typecheck
npm run build
```

Дополнительные сведения находятся в [архитектуре](docs/architecture.md), [управлении веб-сценой](docs/controls.md), [модели помещения](docs/simulation-model.md), [интеграции с backend](docs/backend-integration.md), [сценариях](docs/demo-scenarios.md) и [устранении неполадок](docs/troubleshooting.md).
