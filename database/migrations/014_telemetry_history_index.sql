CREATE INDEX IF NOT EXISTS device_telemetry_sampled_idx ON device_telemetry(device_id,data_source,sampled_at DESC,id DESC);
