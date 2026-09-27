# Устранение неполадок веб-симулятора

## Страница пишет, что 3D-стенд недоступен

Проверьте профиль и состояние контейнеров:

```powershell
docker compose --profile web-demo up -d web-simulator
docker compose --profile web-demo ps
docker compose logs --tail 100 web-simulator backend
```

Headless-сервис должен быть healthy. Его `/healthz` доступен только внутри Compose-сети; порт 8090 не публикуется в LAN.

## Нет данных или команд backend

Проверьте в `.env` `DEVICE_API_TOKEN`, `SIMULATOR_INTERNAL_TOKEN`, `DEVICE_ID` и URL backend. Не выводите секреты в терминал и не добавляйте их в логи. Внутренний токен используется только для Next.js ↔ Python, а device-токен — для REST-контракта виртуального узла.

Логи:

```powershell
docker compose logs -f web-simulator backend
```

Если backend отключён, локальная симуляция продолжает работать. Состояние backend будет показано как offline; pending команды подтверждаются после восстановления связи и фактического выполнения.

## Другой simulator пишет telemetry того же устройства

Для одного `DEVICE_ID` разрешён один активный источник. Выберите `web-demo` или профиль `demo` с REST-only simulator; общий lock volume остановит второй процесс, если оба претендуют на один узел.

## Применены старые frontend-файлы

Пересоберите только сервисы приложения и headless-узла:

```powershell
docker compose --profile web-demo up --build -d backend web-simulator
```

Это пересоздаёт контейнеры, но не удаляет PostgreSQL/ML volumes. Отдельной Windows-сборки или команды Panda3D build больше нет: сцена запускается через браузерную панель.
