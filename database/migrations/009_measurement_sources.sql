ALTER TABLE measurements ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'unknown'
 CHECK (data_source IN ('real','simulator','unknown'));
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'unknown'
 CHECK (data_source IN ('real','simulator','unknown'));
CREATE INDEX IF NOT EXISTS idx_measurements_source_timestamp ON measurements(data_source,"timestamp");
