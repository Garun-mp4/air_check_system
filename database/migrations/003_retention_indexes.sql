-- Supporting indexes for the rolling 24-hour retention job.
-- This migration is safe to run more than once.
CREATE INDEX IF NOT EXISTS idx_predictions_created
    ON predictions (created_at ASC);

CREATE INDEX IF NOT EXISTS idx_actuator_commands_retention
    ON actuator_commands (created_at ASC)
    WHERE status = 'applied';
