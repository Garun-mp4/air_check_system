# Установка, обновление и восстановление

Команды запускаются из корня проекта. Docker Desktop должен быть готов (`docker info`). На этом Windows-хосте перед запуском/ремонтом Docker действует `C:\Users\admin\.codex\docs\docker-desktop-windows.md`. Существующие тома не удалять для обновления схемы или исправления запуска.

## Новая установка с одной ESP32

```text
python deploy/prepare_env.py --out deploy/real.env --mode real
docker compose --env-file deploy/real.env -f docker-compose.yml -f deploy/compose.real.yml build
docker compose --env-file deploy/real.env -f docker-compose.yml -f deploy/compose.real.yml run --rm migrations
docker compose --env-file deploy/real.env -f docker-compose.yml -f deploy/compose.real.yml up -d
```

Заполнить домен/доверенные origins в приватном env до запуска. Секреты устройства, виртуального узла, внутреннего proxy, auth и ML разные; генератор не печатает значения. Для существующего env `--fill-missing` добавляет отсутствующие секреты и сохраняет предыдущий файл. Существующий пароль БД не меняется автоматически: его смена требует согласованного `ALTER ROLE` и обновления конфигурации. Новая установка получает случайный пароль и согласованный DATABASE_URL. Приватные env/backup не включаются в Git.

Override `compose.real.yml` включает real и локальный NTP, а физический симулятор исключает из обычного запуска. Постоянная 3D-страница обслуживается backend и остаётся доступна без Python-симулятора. В simulation используется основной Compose без real override; профили `demo` и web-симулятор не должны одновременно обслуживать один device_id.

Миграционный runner блокирует конкурирующие запуски, записывает SHA-256 каждой SQL-миграции и отклоняет изменение уже применённого файла. Он работает и с существующим томом. При каждом обновлении выполнять `run --rm migrations` до `up -d`; одного изменения файлов в docker-entrypoint-initdb.d недостаточно. Backend ждёт завершения миграций и исправной БД; health проверяет нужные таблицы. ML health проверяет процесс, а отсутствие обученной модели возвращается отдельно и не блокирует интерфейс/управление. Долгоживущие сервисы имеют restart policy; `unhealthy` сам по себе не перезапускает процесс Docker.

Владельца создать интерактивным CLI (`--password-stdin` принимает ровно две строки через закрытый stdin):

```text
docker compose --env-file deploy/real.env --profile maintenance run --rm -it owner-cli bootstrap owner@example.local
```

CLI не передаёт пароль в аргументах. Интерактивный режим нужен для скрытого ввода.

## LAN, TLS и время

DNS/hosts должны разрешать `AIR_CHECK_DOMAIN` в адрес сервера. Разрешить в локальной сети HTTPS TCP 443 и NTP UDP 123; PostgreSQL, ML и web-simulator напрямую в LAN не публикуются. `NTP_BIND_IP` позволяет ограничить интерфейс. Сервис NTP использует часы хоста без внешнего интернета; часы хоста должны быть проверены и синхронизированы.

Caddy создаёт локальный CA. Из контейнера экспортировать только публичный root.crt (`/data/caddy/pki/authorities/local/root.crt`); приватный root.key не копировать в ESP32 или браузер. CA установить в доверенные корни компьютера и указать его PEM в provisioning ESP32. URL в provisioning должен соответствовать SAN сертификата. Нельзя отключать проверку сертификата/hostname для обхода ошибки.

В приватном provisioning JSON задать Wi-Fi, HTTPS origin, device_id, DEVICE_API_TOKEN, ca_file, ntp_server, `commissioned=false` до аппаратной проверки и необязательный `sd_enabled`. Команды подготовки NVS и сборки находятся в firmware/esp32/README.md. После проверки питания/полярности/концевиков/тахометров разрешить commissioned. Карта FAT не форматируется автоматически.

## Резервная копия и репетиция

Копия включает транзакционный pg_dump, модели/историю заданий/экспорты, аватары, Caddy CA/конфигурацию и приватный env. На время копирования не запускать обучение/откат и не изменять аватары/конфигурацию: согласованность между файловыми томами требует спокойного состояния. Сбор телеметрии может продолжаться; pg_dump сохраняет согласованный снимок БД.

```text
python deploy/backup.py create --project air-quality --env-file deploy/real.env --out private-backup.aircheck-backup.zip
python deploy/backup.py verify private-backup.aircheck-backup.zip
```

`verify` проверяет контрольные суммы и безопасные пути архивов, восстанавливает БД в отдельный временный PostgreSQL и извлекает файловые данные во временный каталог. Он не заменяет действующую систему. Копия содержит секреты и приватный CA: хранить её в защищённом/зашифрованном хранилище с ограниченным доступом.

## Восстановление в новый проект

```text
python deploy/backup.py restore-new private-backup.aircheck-backup.zip --project aircheck-restored-rehearsal --env-out deploy/restored.env --port 3300
```

Допускается только новый `aircheck-restored-*` без существующих контейнеров/томов, новый env и отдельный loopback-порт. Восстанавливаются БД и все файловые тома; применяются недостающие миграции. В одной транзакции восстановленные pending-команды отменяются, обратная связь сбрасывается в unknown, очищается кэш текущих кадров и начинается новый период режима; внешние уведомления отключаются. История измерений и raw-кадры сохраняются. До нового пакета устройства старое положение и ошибки не становятся текущими даже при быстром восстановлении. Backend не запускается автоматически. Вывести команду переключения в эксплуатацию можно после проверки восстановленных данных, домена/origins, токенов устройства и CA. Не переименовывать/удалять действующие тома ради восстановления. Для старта восстановленного backend использовать основной Compose плюс `<env>.restore.yml` и `-p` указанного нового проекта; для LAN заранее настроить собственные порты и real override.

## Приёмка

```text
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend audit
python -m pytest aircheck_simulator_3d/tests sensor-simulator ml-service/tests tests/database tests/infrastructure tests/firmware -q
python tests/browser/run.py
```

Для отдельного браузерного сценария real установить `AIRCHECK_BROWSER_MODE=real` перед той же командой. Он использует синтетические пакеты v2 в изолированной БД, проверяет частичный отказ, фактический ACK окна из полноэкранного интерфейса, неизвестное положение, архив и потерю/восстановление связи; настоящую плату не имитирует. Оба режима проверяют разворачивание 3D, сворачивание кнопкой/Esc, сохранение сцены и запасной режим на весь viewport. Если Chromium Playwright не установлен, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` позволяет указать существующий Chromium-браузер (например, Edge на Windows).

Compose E2E запускается с `AIRCHECK_RUN_COMPOSE_E2E=1`: проверяет реальные HTTP/БД/ML, команды/ACK, потери связи, lease, локальный TLS/NTP и backup/restore в изолированных ресурсах. Browser E2E использует отдельную БД и синтетическую учётную запись; Telegram заменён локальным тестовым HTTP-приёмником. Артефакты проверки находятся в tests/browser/artifacts (исключены из Git). Прошивка проверяется отдельным workflow с native ASan/UBSan и двумя сборками ESP-IDF. Требуемые реальные аппаратные проверки перечислены в implementation-one-esp32.md.
