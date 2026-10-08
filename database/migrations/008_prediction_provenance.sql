-- Legacy rows remain unlinked; timestamps alone do not prove provenance.
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS prediction_status TEXT NOT NULL DEFAULT 'pending' CHECK (prediction_status IN ('pending','ready','insufficient_history','unavailable'));
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS prediction_error TEXT;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS prediction_error_code TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS measurement_id BIGINT REFERENCES measurements(id) ON DELETE SET NULL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS source_timestamp TIMESTAMPTZ;
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS measurement_id BIGINT REFERENCES measurements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_measurement ON predictions (measurement_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_measurement ON recommendations (measurement_id, created_at DESC, id DESC);
