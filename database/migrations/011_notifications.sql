CREATE TABLE IF NOT EXISTS notification_settings (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 co2_duration_seconds INTEGER NOT NULL DEFAULT 300 CHECK(co2_duration_seconds BETWEEN 1 AND 86400),
 offline_duration_seconds INTEGER NOT NULL DEFAULT 60 CHECK(offline_duration_seconds BETWEEN 1 AND 86400),
 suppression_seconds INTEGER NOT NULL DEFAULT 900 CHECK(suppression_seconds BETWEEN 0 AND 86400),
 telegram_chat_id TEXT,
 token_ciphertext TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_conditions (
 device_id TEXT NOT NULL, kind TEXT NOT NULL, since_at TIMESTAMPTZ,
 active BOOLEAN NOT NULL DEFAULT FALSE, last_alert_at TIMESTAMPTZ, last_check_at TIMESTAMPTZ,
 PRIMARY KEY(device_id,kind)
);
CREATE TABLE IF NOT EXISTS notification_events (
 id BIGSERIAL PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('co2_high','device_offline','command_failed','recovery','channel_test')),
 message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 destination_chat TEXT,
 delivery_status TEXT NOT NULL DEFAULT 'disabled' CHECK(delivery_status IN ('disabled','pending','sending','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_attempt_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, delivery_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_notification_events_created ON notification_events(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_due ON notification_events(next_attempt_at,id) WHERE delivery_status IN ('pending','sending');
CREATE TABLE IF NOT EXISTS notification_reads (
 event_id BIGINT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 read_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(event_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_command_terminal ON actuator_commands(device_id,target,id DESC) WHERE status IN ('applied','failed','expired');
