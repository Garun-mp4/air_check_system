# Сборка и устранение неполадок

## Windows standalone build

Используйте 64-битный Python 3.12. Из корня репозитория:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r aircheck_simulator_3d/requirements-dev.txt
.\scripts\build-windows.ps1
.\scripts\smoke-windows-build.ps1
```

Panda3D `build_apps` формирует автономный каталог в `build/win_amd64`; передавать нужно каталог целиком. GUI-сборка не открывает консоль. Логи: `%LOCALAPPDATA%\AirCheck3D\panda.log` и `%LOCALAPPDATA%\AirCheck3D\logs\*.log`. В разработке логи лежат в `aircheck_simulator_3d/logs`.

## Проблемы запуска

- **Нет окна / завершение при запуске:** проверьте `application.log` и `panda.log`, установлен ли совместимый графический драйвер, запущена ли 64-битная Windows.
- **Не загружается интерфейсный шрифт:** измените `ui_font_path` в `config/graphics.toml`; приложение пробует Segoe UI и Arial как fallback.
- **Нет теней или сглаживания:** выберите Medium/Low либо проверьте возможности framebuffer/драйвера. Отсутствие MSAA само по себе не блокирует запуск.
- **Окно 3D слишком тяжёлое:** запустите `--quality low`, затем medium. Рендер ограничен `target_fps`, физика идёт своим fixed timestep.

## Backend и ML

- **Backend OFFLINE:** сверьте `backend_url`, доступность host/port и `device_id`. `network.log` содержит timeout, HTTP status и retry.
- **Offline не восстанавливается:** убедитесь, что endpoint `/api/v1/measurements/latest` доступен; worker проверяет его отдельно от Panda UI.
- **Прогноз недоступен:** backend возвращает null, пока модель не обучена или не собрана история на 5/10 минут. Соберите историю и обучите ML тем же поддерживаемым pipeline; для Docker Compose в папке `ml-service`:

  ```powershell
  docker compose exec ml-service python train.py --source-url "http://backend:3000/api/v1/measurements/history?limit=5000" --min-rows 30
  ```

- **AUTO DEMO ждёт backend-команду:** проверьте прогноз, пороги/автоматику backend, `device_id`, окна `pending_commands` в dashboard и сетевой журнал. Simulator намеренно не создаёт команду сам.
- **Команда осталась в движении:** окно подтверждается только после достижения концевика. Проверьте состояние мотора и `actual_position` в панели устройства.
- **Dashboard показывает неактуальные данные:** проверьте свежий `timestamp` measurement, фактический online-state узла и что dashboard обращается к тому же backend URL.

## Проверки разработчика

```powershell
.\.venv\Scripts\python.exe -m pytest aircheck_simulator_3d/tests -q
.\.venv\Scripts\python.exe -m aircheck_simulator_3d --smoke-test-seconds 5 --quality low
```

Offline, HTTP timeout, ошибочный формат ответа, retries, последняя телеметрия и остановка worker покрываются тестами `test_networking.py`. Длительные model runs проверяются в `test_long_simulation.py`.
