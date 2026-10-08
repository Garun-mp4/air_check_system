ALTER TABLE node_settings ADD COLUMN IF NOT EXISTS outdoor_policy JSONB NOT NULL DEFAULT '{"maxPm25":35,"pm25Recovery":30,"minTemperature":5,"temperatureRecovery":7,"filteredIntake":false,"maxAgeSeconds":90}';
ALTER TABLE actuator_states ADD COLUMN IF NOT EXISTS outdoor_safety JSONB;
ALTER TABLE actuator_states ADD COLUMN IF NOT EXISTS ventilation_started_at TIMESTAMPTZ;
