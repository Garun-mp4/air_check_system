# ML pipeline

ML-сервис остаётся отдельным Python HTTP-сервисом на порту 8000. TypeScript-сервер вызывает POST /predict и сохраняет только проверенный результат.

## Признаки

Используется фиксированный порядок:

~~~text
current_co2
indoor_temperature
indoor_humidity
indoor_pm25
outdoor_temperature
outdoor_humidity
outdoor_pm25
window_open
co2_change_5min
co2_change_10min
hour
~~~

Для строки обучения требуются точки примерно через 5 и 10 минут в пределах допустимого разрыва 2 минуты, а target — измерение через 15 минут. Строки с недостаточной историей или без будущего target исключаются. В prediction-фичи попадают только данные на момент текущего измерения.

## Обучение

train.py получает history API или JSON-файл, готовит CSV-датасет, выполняет временное разбиение 80/20 без shuffle, сравнивает LinearRegression и RandomForestRegressor.

Для каждой модели сохраняются MAE и RMSE. Модель с меньшим RMSE (при равенстве — MAE) сохраняется в model.joblib вместе со схемой признаков, названием, версией и метаданными обучения. Метрики сохраняются в training_metrics.json.

## Prediction contract

POST /predict получает плоское тело с полями, соответствующими перечисленным признакам, и возвращает:

~~~json
{
  "predicted_co2_15min": 934.12,
  "model": "random_forest",
  "model_version": "1.0"
}
~~~

Если model.joblib отсутствует, сервис возвращает 503 model_unavailable. TypeScript-клиент проверяет HTTP-код, JSON, числовой прогноз, model и model_version; malformed response не превращается в фиктивное значение.
