BEGIN;
CREATE TABLE IF NOT EXISTS runtime_device_modes (
    device_id TEXT PRIMARY KEY,
    data_source TEXT CHECK (data_source IN ('real', 'simulator')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMIT;
