ALTER TABLE device_telemetry ADD COLUMN IF NOT EXISTS delivery_kind TEXT NOT NULL DEFAULT 'live' CHECK (delivery_kind IN ('live','archive'));
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS historical_only BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS measurements_live_source_idx ON measurements(data_source,"timestamp" DESC,id DESC) WHERE NOT historical_only;
