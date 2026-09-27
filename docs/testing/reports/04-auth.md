# Блок 04 — авторизация, сессии, роли и аккаунты

## Область и границы

Добавлены проверки серверной политики Better Auth, чтения сессии и вычисления роли, сроков прав оператора, владельческих и операторских ворот, браузерных auth-маршрутов, управления аккаунтами, owner recovery CLI, безопасных redirect/origin и отдельной device bearer-авторизации.

Маршруты обычного REST API проверяются только в части допуска по роли и same-origin. Валидация тел, сериализация измерений, состояние узла и логика команд остаются в границах блока 03 и здесь не дублируются. Production-код, конфигурация продукта и миграции не менялись.

Тесты auth-политики, доступа, route handlers и recovery CLI используют моки Better Auth/PostgreSQL. В репозитории нет выделенного frontend integration harness с тестовой PostgreSQL. Поэтому они проверяют вызовы и SQL-последовательность на границе приложения, а не реальное создание/удаление сессии в PostgreSQL.

## Новые файлы

| Файл | Новые тесты | Что проверяется |
|---|---:|---|
| `frontend/src/server/auth-policy.test.ts` | 4 | Обязательный секрет; разрешённая email-регистрация и минимум пароля из документации; hook выдаёт новой учётной записи роль `user`; cookie flags для production и локального режима. |
| `frontend/src/server/access-session.test.ts` | 17 | Guest без сессии; роли `user`, `operator`, `owner`; истечение operator grant на точной границе и бессрочный grant; матрицы `requireOperator`/`requireOwner`; fail-closed при ошибке хранилища; разделение browser cookie и device bearer token. |
| `frontend/src/app/api/auth-authorization.test.ts` | 23 | Передача GET/POST в Better Auth; безопасная проекция `/api/auth/access`; owner-only list/create/update/delete; отсутствие credential/session полей в ответах; запрет self-escalation и назначения роли owner; срок и аудит operator grant; защита owner; допуск к командным/симуляторным маршрутам и machine-only auth. |
| `frontend/src/lib/auth-navigation-security.test.ts` | 13 | Внешние и protocol-relative targets; локальный путь с query/hash; same-origin за HTTPS proxy; отклонение отсутствующего, opaque, чужого origin, другого порта и схемы. Один тест оставлен красным из-за найденного дефекта, см. ниже. |
| `frontend/src/server/owner-recovery.test.ts` | 2 | Recovery CLI хеширует новый пароль, требует существующую учётную запись с ролью owner, отзывает её сессии, сохраняет роль и добавляет audit-запись; запрос для аккаунта без роли owner откатывается без смены пароля; пароль не выводится в лог. PostgreSQL заменён тестовым double. |

Всего добавлено **59 тестов**. В целевой набор также вошли уже существовавшие тесты `access.test.ts`, `trusted-origins.test.ts`, `auth-navigation.test.ts`, `auth-errors.test.ts` и `access-types.test.ts` — **14 тестов**.

## Проверка

Команды выполнялись из `frontend/`.

Базовый набор до изменений:

```powershell
npm test -- --reporter=dot src/server/access.test.ts src/server/trusted-origins.test.ts src/lib/auth-navigation.test.ts src/lib/auth-errors.test.ts src/lib/access-types.test.ts
```

Результат: 5 файлов, 14 passed.

Полный целевой набор блока 04:

```powershell
npm test -- --reporter=dot src/server/access.test.ts src/server/trusted-origins.test.ts src/lib/auth-navigation.test.ts src/lib/auth-errors.test.ts src/lib/access-types.test.ts src/server/auth-policy.test.ts src/server/access-session.test.ts src/app/api/auth-authorization.test.ts src/lib/auth-navigation-security.test.ts src/server/owner-recovery.test.ts
```

Результат: **10 файлов; 72 passed, 1 failed, 0 skipped; всего 73 теста**. Единственный упавший тест воспроизводит дефект продукта, а не сбой тестовой среды.

```powershell
npm run typecheck
npm run lint
```

Обе команды завершились успешно. В `package.json` скрипт `lint` сейчас также запускает `tsc --noEmit`.

## Найденный дефект

`getSafeReturnPath('/..//outside.example/path')` возвращает `//outside.example/path`. Функция проверяет исходную строку на `//`, а затем возвращает нормализованный `pathname`; URL-нормализация превратила локально выглядящий вход в protocol-relative адрес. `AuthPanel` передаёт результат в `router.replace`, поэтому проверка не обеспечивает заявленный возврат только на локальный адрес.

В исходном прогоне тест `frontend/src/lib/auth-navigation-security.test.ts` намеренно оставлен failing, а production-код не изменялся. Текущее состояние после исправления описано ниже.

В первом исследовательском прогоне также была исправлена ошибка ожидания параметров audit-запроса в новом recovery-тесте. В финальном прогоне она больше не воспроизводится.

## Не зафиксированные контрактом вопросы

- Документы задают минимум пароля 12 символов и общий жизненный цикл входа, но не определяют максимальную длину, срок сессии, `updateAge` и окна/лимиты rate limiting. Тесты не закрепляют эти значения; нужно решить, какие из них являются стабильной политикой, и документировать их перед фиксацией контрактных тестов.
- Успешная регистрация/вход, фактическая выдача сессионной cookie и её удаление при logout пока проверяются только через конфигурацию auth и передачу запросов в Better Auth. Для интеграционного подтверждения нужен тестовый PostgreSQL и сценарий с реальным Better Auth handler.
- Уникальный индекс единственного owner и транзакционные ограничения recovery/role update проверены по миграции и SQL-последовательностям с doubles, но не запускались против PostgreSQL. Это можно добавить, когда появится интеграционный стенд базы.

## Результат исправления

`getSafeReturnPath` теперь повторно проверяет путь после нормализации `URL`: protocol-relative путь отклоняется и заменяется на `/`, локальные query и fragment сохраняются. Это устраняет обход через `/..//outside.example/path`. Документ `docs/web-simulator.md` фиксирует политику локального возврата.

Целевой auth-набор повторно пройден: **10 файлов, 73 passed, 0 failed, 0 skipped**. Более широкая frontend-проверка также прошла: **37 файлов, 292 passed**.
