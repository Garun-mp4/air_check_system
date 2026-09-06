-- Desired and reported state for the local ventilation/window control loop.
CREATE TABLE IF NOT EXISTS actuator_states (
    device_id TEXT PRIMARY KEY,
    exhaust_on BOOLEAN NOT NULL DEFAULT FALSE,
    intake_on BOOLEAN NOT NULL DEFAULT FALSE,
    window_open BOOLEAN NOT NULL DEFAULT FALSE,
    desired_exhaust_on BOOLEAN NOT NULL DEFAULT FALSE,
    desired_intake_on BOOLEAN NOT NULL DEFAULT FALSE,
    desired_window_open BOOLEAN NOT NULL DEFAULT FALSE,
    window_mode TEXT NOT NULL DEFAULT 'auto'
        CHECK (window_mode IN ('auto', 'manual')),
    override_until TIMESTAMPTZ,
    window_open_since TIMESTAMPTZ,
    last_reported_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS actuator_commands (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES actuator_states(device_id) ON DELETE CASCADE,
    target TEXT NOT NULL CHECK (target IN ('exhaust', 'intake', 'window')),
    desired_state BOOLEAN NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'automatic')),
    reason TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'applied')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_actuator_commands_pending
    ON actuator_commands (device_id, status, id ASC);

CREATE INDEX IF NOT EXISTS idx_actuator_commands_created
    ON actuator_commands (device_id, created_at DESC, id DESC);
