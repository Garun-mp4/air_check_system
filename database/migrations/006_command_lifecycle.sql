-- Upgrade both populated and fresh installations without dropping commands.
ALTER TABLE actuator_commands ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE actuator_commands ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE actuator_commands ADD COLUMN IF NOT EXISTS failure_reason TEXT;
UPDATE actuator_commands SET expires_at = created_at + CASE WHEN source = 'manual' THEN INTERVAL '5 minutes' ELSE INTERVAL '2 minutes' END WHERE expires_at IS NULL;
UPDATE actuator_commands SET completed_at = applied_at WHERE status = 'applied' AND completed_at IS NULL;
ALTER TABLE actuator_commands ALTER COLUMN expires_at SET DEFAULT (clock_timestamp() + INTERVAL '5 minutes');
ALTER TABLE actuator_commands ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE actuator_commands DROP CONSTRAINT IF EXISTS actuator_commands_status_check;
ALTER TABLE actuator_commands ADD CONSTRAINT actuator_commands_status_check CHECK (status IN ('pending', 'applied', 'failed', 'cancelled', 'expired'));
CREATE INDEX IF NOT EXISTS idx_actuator_commands_expiry ON actuator_commands (device_id, expires_at) WHERE status = 'pending';
DROP INDEX IF EXISTS idx_actuator_commands_retention;
CREATE INDEX idx_actuator_commands_retention ON actuator_commands (created_at ASC) WHERE status <> 'pending';
