# AirCheck: браузерный 3D-стенд и доступ

## Как устроена веб-версия

```text
Three.js / React Three Fiber
  сцена, камера, picking, HUD, карточки, режимы отображения
       │ same-origin SSE и действия через Next.js
       ▼
Next.js — AirCheck UI, сессии и проверка роли на каждом действии
       │ закрытый внутренний HTTP API
       ▼
Python headless simulator — 10 Гц, один Simulation Core и Device Layer
       │ существующие REST measurements / pending commands / actual state
       ▼
AirCheck backend → PostgreSQL / ML-прогноз → автоматика / очередь команд
       ▲                                                       │
       └──────── telemetry / прогноз / ACK фактического состояния ┘
```

В браузере находятся только представление и пользовательские действия. Расчёт CO₂, PM2.5, температуры, влажности и потоков воздуха остаётся в Python. Снимок `/v1/state` и SSE `/v1/events` читают единую модель `SimulationCoordinator`; desktop-приложение Panda3D продолжает использовать тот же coordinator. UI не меняет actual state устройства.

Панель выдаёт команды окну и вентиляторам через существующий `/api/v1/controls/commands` и `/api/v1/controls/ventilation`. Python-узел получает их через текущую очередь, двигает створку/вентилятор в Device Layer, публикует actual state и подтверждает выполненную команду. Форматы telemetry и ACK AirCheck не менялись.

Новый внутренний контракт Next.js ↔ simulator:

| Маршрут | Назначение | Доступ |
|---|---|---|
| `GET /v1/state` | Начальный снимок общей симуляции | Только внутренний service token |
| `GET /v1/events` | События `snapshot` по SSE | Только внутренний service token |
| `POST /v1/actions` | Сценарий, скорость, demo и debug | Только внутренний service token; Next.js дополнительно требует оператора |
| `GET /api/simulator/state` | Same-origin proxy для первого снимка | Просмотр гостю разрешён |
| `GET /api/simulator/events` | Same-origin proxy для SSE | Просмотр гостю разрешён |
| `POST /api/simulator/actions` | Same-origin proxy пользовательских действий | Только оператор/владелец и проверенный Origin |

Управляющие HTTP-маршруты AirCheck отделены от входа человека. `DEVICE_API_TOKEN` нужен только виртуальному/физическому устройству и machine-маршрутам measurements, polling очереди и ACK. `SIMULATOR_INTERNAL_TOKEN` используется только между Next.js и headless service.

## Запуск в Docker Compose

Нужны Docker Desktop с запущенным Linux Engine и PowerShell. Первый запуск:

```powershell
Copy-Item .env.example .env
```

Задайте в `.env` три независимых случайных значения не короче 32 символов:

- `DEVICE_API_TOKEN` — device API;
- `SIMULATOR_INTERNAL_TOKEN` — только Python service proxy;
- `BETTER_AUTH_SECRET` — подпись сессии Better Auth.

Сгенерировать значение можно локально командой `openssl rand -hex 32`. Не вставляйте значения в исходники, не публикуйте `.env`. Для одной LAN-инсталляции также согласуйте `AIR_CHECK_DOMAIN`, `AIR_CHECK_PUBLIC_URL`, `BETTER_AUTH_URL` и `BETTER_AUTH_TRUSTED_ORIGINS`.

После настройки:

```powershell
docker compose --profile web-demo up --build -d
docker compose ps
```

Панель открывается по `https://aircheck.home.arpa`, 3D-стенд — по `https://aircheck.home.arpa/simulator`. `https-proxy` — единственный LAN-вход (80/443); backend доступен на localhost для разработки, Python service и базы не публикуют порты в LAN, PostgreSQL и ML-service привязаны к loopback.

### DNS и доверие HTTPS

Для клиентских устройств имя `aircheck.home.arpa` должно разрешаться в LAN-IP компьютера, где запущен Compose. Это можно задать в локальном DNS роутера или hosts-файле компьютера. Caddy создаёт сертификат от локального внутреннего CA; чтобы браузер не показывал предупреждение, экспортируйте и установите корневой сертификат на каждый клиент:

```powershell
docker compose cp https-proxy:/data/caddy/pki/authorities/local/root.crt "$env:TEMP\aircheck-root.crt"
```

Установите этот публичный корневой сертификат в `Local Computer → Trusted Root Certification Authorities` Windows на клиенте. Не копируйте закрытый ключ CA (`root.key`). Если домен или URL изменён, настройте локальный DNS и `BETTER_AUTH_TRUSTED_ORIGINS` для того же origin.

### Существующая база и первый владелец

При первом создании PostgreSQL volume migration `005_auth.sql` применится автоматически вместе с остальными SQL-файлами. Для установки с уже существующим volume запустите её один раз:

```powershell
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/005_auth.sql'
```

Создайте единственную учётную запись владельца. Команда запросит email и пароль без отображения пароля в терминале; пароля по умолчанию нет:

```powershell
docker compose exec backend npm run owner -- bootstrap
```

Для восстановления доступа существующего владельца, сохраняя его роль:

```powershell
docker compose exec backend npm run owner -- recover owner@example.org
```

Самостоятельного восстановления через email пока нет: SMTP не подключён. Владелец может создавать учётные записи через раздел «Аккаунты» или выполнить административное восстановление командой.

## Профили simulator и защита от двух источников

Один `DEVICE_ID` должен иметь ровно один активный генератор. Web-вариант:

```powershell
docker compose --profile web-demo up -d web-simulator
```

Старый REST-only `sensor-simulator` остаётся резервным:

```powershell
docker compose --profile demo up -d simulator
```

Для обоих процессов подключён общий Docker volume с межпроцессной блокировкой по `DEVICE_ID`. Если второй процесс стартует для того же узла, он завершится с явной ошибкой; разные `DEVICE_ID` используют разные блокировки. Для перехода между профилями остановите предыдущий источник:

```powershell
docker compose stop web-simulator
docker compose --profile demo up -d simulator
```

Standalone Panda3D simulator и его EXE сохранены как отдельный резерв. В вебе используются общие Python-физика, сценарии и Device Layer, но рендеринг сцены выполняется в браузере.

## Пользовательские роли

| Роль | Просмотр | Команды, настройки, сценарии и debug | Учётные записи и роли |
|---|---:|---:|---:|
| Гость | Да | Нет | Нет |
| Пользователь | Да | Нет | Нет |
| Оператор | Да | Да | Нет |
| Владелец установки | Да | Да | Да |

Регистрация по email и паролю открыта; новый аккаунт получает только просмотр. Пароль не короче 12 символов. Владелец выдаёт или отзывает роль оператора, задаёт срок окончания либо оставляет её постоянной. API проверяет истечение срока при каждом управляющем запросе. Оператор не может изменить свои права, удалить или повысить другого пользователя. Единственный владелец ограничен уникальным частичным индексом БД и защищён от изменения/удаления через панель.

Ограничения реализованы на сервере Next.js; отключённая кнопка в UI не считается границей доступа. Read-only API остаётся доступен гостю по согласованной модели. POST-команды и настройки требуют сессию оператора/владельца и same-origin проверку. Machine-маршруты не принимают browser session вместо отдельного bearer token.

## Возможности браузерной сцены

- отдельная вкладка «3D-стенд» в панели и прямой путь `/simulator`;
- светлая комната, зелёное основание и голубое небо;
- наружный и внутренний стеновые узлы, шкаф управления, вентиляторы, окно и проводка;
- выбор устройств через picking, подсветка и live-панели;
- Normal / Airflow / Sensors / Wiring / Technical;
- стена Visible / Transparent / Hidden;
- orbit camera, панорамирование, колесо зума, WASD, Q/E, Shift, фокус на выбранном объекте и сброс камеры;
- HUD indoor/outdoor, фактические состояния окна/вентиляции, airflow, расход и backend ML forecast;
- девять сценариев из Python-конфигурации и автоматический demo;
- диапазоны Developer Panel берутся из `demo.toml`;
- guest/user могут просматривать сцену, но управляющие элементы требуют оператора.

Визуализация потока использует фактические расходы `window_m3_h`, `intake_m3_h`, `exhaust_m3_h` из Python. Частицы и вращение вентилятора не запускаются, когда соответствующее устройство выключено.

## Проверки и ограничения

Локальные проверки запускаются из корня проекта:

```powershell
python -m pytest aircheck_simulator_3d/tests sensor-simulator -q
cd frontend
npm run typecheck
npm test
npm run build
```

Окно desktop-симулятора и новая веб-сцена рендерят один simulation/device coordinator, но их UI-компоненты независимы. Полный end-to-end путь с ML/очередью/ACK требует доступного Docker Engine, корректных secrets, запущенных PostgreSQL/backend/ML и накопленной истории для модели. При offline backend headless simulation продолжает обновляться локально, а UI показывает фактический сетевой статус.

Известное инфраструктурное условие: внутренний CA Caddy нужно доверить каждому устройству в LAN. Без этого HTTPS-соединение шифруется, но браузер предупреждает о недоверенном сертификате. SMTP, подтверждение адреса и самостоятельный email-reset пока не подключены.
