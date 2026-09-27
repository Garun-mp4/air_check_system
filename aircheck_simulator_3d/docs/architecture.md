# Архитектура браузерного 3D-стенда

```text
Three.js / React Three Fiber
  модели, камера, picking, HUD, сценарии отображения
           ↕ same-origin API / SSE
Next.js
  сессия, проверка ролей и маршрутизация действий
           ↕ внутренний HTTP с service token
Python headless simulator
  SimulationCoordinator → Simulation Core → Device Layer
           ↕ существующий AirCheck REST-контракт
Backend → PostgreSQL / ML → автоматика → очередь команд
```

## Ответственность компонентов

- `simulation/` считает качество воздуха фиксированными шагами независимо от частоты кадров.
- `devices/` хранит фактические состояния датчиков, вентиляции и оконного привода. Команда не считается исполненной до достижения реального состояния.
- `app/coordinator.py` применяет сценарии, developer actions, телеметрию и результаты сетевого обмена.
- `networking/web_service.py` предоставляет внутренний snapshot/SSE/API; доступен только backend внутри Compose-сети.
- `frontend/src/components/simulator/scene/` отображает снимок. Геометрия окна, вращение вентиляторов, airflow и индикаторы привязаны к данным текущего снимка.
- `scene/device_models/layout.py` задаёт размеры помещения, точки настенных креплений и общие маршруты. Координаты сериализуются в snapshot и используются браузером.

Desktop entry point и скрипты упаковки Panda3D-приложения удалены. Python-модель и Device Layer работают как headless-компоненты и являются источником состояния веб-сцены и виртуального IoT-узла.

## Частоты

| Подсистема | Частота |
|---|---:|
| Simulation Core | фиксированный шаг 0,1 с |
| Snapshot и SSE | события изменения состояния |
| React UI | по обновлению snapshot и пользовательским действиям |
| Three.js rendering | определяется браузером и устройством |
| AirCheck REST workers | интервалы из `config/backend.toml` |

Изменение FPS браузера не меняет интегрирование физики.
