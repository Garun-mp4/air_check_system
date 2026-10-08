# Браузерные интеграционные проверки

Требования: Node 24, Python 3.12, Docker Engine, зависимости frontend, ML и headless simulator, Chromium с WebGL. В CI Chromium и системные библиотеки устанавливает `npx playwright install --with-deps chromium`.

```sh
npm --prefix frontend ci
python -m pip install -r ml-service/requirements.txt -r aircheck_simulator_3d/requirements-headless.txt
cd frontend
npx playwright install --with-deps chromium
npm run build
cd ..
python tests/browser/run.py
```

Можно задать `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. Команда `npm run test:e2e` использует `python` из активированного окружения. Запускайте после production build. Не запускайте две сборки или два browser-run одновременно в одном checkout.

Стенд создаёт PostgreSQL с уникальной меткой и tmpfs, случайные порты, собственные сервисы и временный каталог модели/секретов. Учётные записи используют настоящий Better Auth, а команды исполняет настоящий headless simulator. При завершении, включая ошибку теста, завершаются только созданные процессы и контейнер с совпадающей меткой. Существующие базы и volumes не используются.

Проверяются вход/неверный пароль/cookie/выход, пользовательские и операторские права, настройки, исполнение до фактического ACK, отмена и истечение, прогнозы текущего измерения, шесть размеров экрана, клавиатура и выбор объекта raycast в настоящей WebGL-сцене. Отсутствующий WebGL вызывает ошибку.

Диагностика находится в `tests/browser/artifacts/`: HTML, trace и screenshot при ошибке, логи сервисов. Каталог исключён из git. Trace содержит тестовые сессии; CI хранит его только 3 дня. Повторный запуск создаёт новый чистый стенд.

Начиная с M5 набор также запускает обучение настоящей модели из owner-панели, проверяет запрет оператору, недостаточность выбранного источника с сохранением активной модели и возврат предыдущей версии. Данные стенда помечены simulator, отдельно проверяются сопоставления real. ML management использует случайный внутренний токен стенда.

M6 добавляет месячную сводку, CSV download и политику поздней телеметрии. M7 проверяет CO₂/command/offline эпизоды, подавление, восстановление, own read mark, owner-настройки и зашифрованный токен. Локальный Telegram HTTP-стенд отвечает ошибкой на первые две попытки, затем принимает сообщение; сервер не обращается в реальный Telegram. Фикстура ускоряет due timestamp в отдельной БД, не меняя production retry policy.
