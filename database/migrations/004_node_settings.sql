-- Persistent operator settings for each local air-quality node.
-- The application seeds this row from environment defaults on first access.
CREATE TABLE IF NOT EXISTS node_settings (
    device_id TEXT PRIMARY KEY,
    automation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    auto_window_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    manual_override_minutes INTEGER NOT NULL DEFAULT 30
        CHECK (manual_override_minutes BETWEEN 1 AND 240),
    auto_ventilation_minimum_minutes INTEGER NOT NULL DEFAULT 5
        CHECK (auto_ventilation_minimum_minutes BETWEEN 1 AND 120),
    co2_normal_threshold DOUBLE PRECISION NOT NULL DEFAULT 800
        CHECK (co2_normal_threshold BETWEEN 250 AND 10000),
    co2_critical_threshold DOUBLE PRECISION NOT NULL DEFAULT 1000
        CHECK (co2_critical_threshold BETWEEN 250 AND 10000),
    pm25_good_limit DOUBLE PRECISION NOT NULL DEFAULT 15
        CHECK (pm25_good_limit BETWEEN 0 AND 1000),
    pm25_elevated_limit DOUBLE PRECISION NOT NULL DEFAULT 35
        CHECK (pm25_elevated_limit BETWEEN 0 AND 1000),
    alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT node_settings_co2_threshold_order
        CHECK (co2_critical_threshold > co2_normal_threshold),
    CONSTRAINT node_settings_pm25_threshold_order
        CHECK (pm25_elevated_limit > pm25_good_limit)
);
