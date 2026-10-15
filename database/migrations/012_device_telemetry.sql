BEGIN;

ALTER TABLE measurements ADD COLUMN IF NOT EXISTS ingest_key TEXT;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS outdoor_sampled_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS measurements_ingest_key_idx ON measurements(ingest_key);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ingest_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS predictions_ingest_key_idx ON predictions(ingest_key);
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS ingest_key TEXT;
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS forecast_used BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS recommendations_ingest_key_idx ON recommendations(ingest_key);
-- NULL preserves the legacy protocol; an explicit empty list means unknown feedback.
ALTER TABLE actuator_states ADD COLUMN IF NOT EXISTS known_targets TEXT[];

CREATE TABLE IF NOT EXISTS device_telemetry (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    data_source TEXT NOT NULL CHECK (data_source IN ('real', 'simulator')),
    boot_id TEXT NOT NULL,
    sequence BIGINT NOT NULL CHECK (sequence >= 0),
    sampled_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_hash TEXT NOT NULL,
    UNIQUE (device_id, data_source, boot_id, sequence)
);
CREATE INDEX IF NOT EXISTS device_telemetry_received_idx ON device_telemetry (received_at);

CREATE TABLE IF NOT EXISTS device_telemetry_heads (
    device_id TEXT NOT NULL,
    data_source TEXT NOT NULL CHECK (data_source IN ('real', 'simulator')),
    frame_id BIGINT REFERENCES device_telemetry(id) ON DELETE SET NULL,
    PRIMARY KEY (device_id, data_source)
);

-- Retain the identity of old boots after pruning raw telemetry, so delayed SD
-- packets from an old session cannot take ownership of the current device.
CREATE TABLE IF NOT EXISTS device_telemetry_boots (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    data_source TEXT NOT NULL CHECK (data_source IN ('real', 'simulator')),
    boot_id TEXT NOT NULL,
    first_received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (device_id, data_source, boot_id)
);

COMMIT;
