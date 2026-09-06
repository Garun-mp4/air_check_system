# REST/JSON API

Все endpoints TypeScript-сервера находятся в Next.js route handlers и работают относительно /api/v1.

## POST /api/v1/measurements

Входное тело:

~~~json
{
  "timestamp": "2026-09-06T10:00:00Z",
  "indoor": {
    "co2": 720,
    "temperature": 23.4,
    "humidity": 45,
    "pm25": 5.2
  },
  "outdoor": {
    "temperature": 18,
    "humidity": 60,
    "pm25": 8
  },
  "window_open": false
}
~~~

Дата должна содержать часовой пояс. Сервер проверяет типы, конечность и физически допустимые диапазоны значений, затем сохраняет запись в measurements. В ответе 201 возвращаются измерение, прогноз (если достаточно истории и ML-сервис доступен), рекомендация и prediction_status.

simulator отправляет именно это тело. Поэтому будущая ESP32 сможет заменить simulator без отдельного endpoint или преобразователя.

## GET /api/v1/measurements/latest

Ответ:

~~~json
{
  "data": {
    "measurement": {
      "id": 481,
      "created_at": "2026-09-06T10:00:00.100Z",
      "timestamp": "2026-09-06T10:00:00.000Z",
      "indoor": {"co2": 720, "temperature": 23.4, "humidity": 45, "pm25": 5.2},
      "outdoor": {"temperature": 18, "humidity": 60, "pm25": 8},
      "window_open": false
    },
    "prediction": null,
    "recommendation": null
  }
}
~~~

До первого измерения вложенные значения равны null. Это позволяет frontend показать штатное empty-state.

## GET /api/v1/measurements/history

Параметры from и to — необязательные RFC3339 даты, limit — число от 1 до 1000. Ответ содержит data с измерениями в порядке возрастания времени и meta.

## GET /api/v1/prediction/latest и GET /api/v1/recommendation

Возвращают { "data": ... }. До появления записи data равен null.

## Ошибки

~~~json
{
  "error": {
    "code": "validation_error",
    "message": "Проверьте данные запроса",
    "fields": [
      {"field": "window_open", "message": "должно быть boolean"}
    ]
  }
}
~~~

Ошибки базы и внешнего сервиса не раскрывают внутренние детали SQL. Ошибка ML-прогноза не отменяет сохранение измерения.
