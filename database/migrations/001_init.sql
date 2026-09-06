CREATE TABLE IF NOT EXISTS measurements (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "timestamp" TIMESTAMPTZ NOT NULL,
    indoor_co2 DOUBLE PRECISION NOT NULL CHECK (indoor_co2 >= 0 AND indoor_co2 <= 20000),
    indoor_temperature DOUBLE PRECISION NOT NULL CHECK (indoor_temperature >= -80 AND indoor_temperature <= 100),
    indoor_humidity DOUBLE PRECISION NOT NULL CHECK (indoor_humidity >= 0 AND indoor_humidity <= 100),
    indoor_pm25 DOUBLE PRECISION NOT NULL CHECK (indoor_pm25 >= 0 AND indoor_pm25 <= 5000),
    outdoor_temperature DOUBLE PRECISION NOT NULL CHECK (outdoor_temperature >= -100 AND outdoor_temperature <= 100),
    outdoor_humidity DOUBLE PRECISION NOT NULL CHECK (outdoor_humidity >= 0 AND outdoor_humidity <= 100),
    outdoor_pm25 DOUBLE PRECISION NOT NULL CHECK (outdoor_pm25 >= 0 AND outdoor_pm25 <= 5000),
    window_open BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_measurements_timestamp
    ON measurements ("timestamp" ASC, id ASC);

CREATE TABLE IF NOT EXISTS predictions (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    target_time TIMESTAMPTZ NOT NULL,
    predicted_co2 DOUBLE PRECISION NOT NULL CHECK (predicted_co2 >= 0 AND predicted_co2 <= 20000),
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_predictions_target_created
    ON predictions (target_time DESC, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS recommendations (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),
    reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recommendations_created
    ON recommendations (created_at DESC, id DESC);

