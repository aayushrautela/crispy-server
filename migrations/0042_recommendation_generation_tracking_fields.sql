ALTER TABLE recommendation_generation_jobs
    ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
    ADD COLUMN IF NOT EXISTS result_applied_at timestamptz,
    ADD COLUMN IF NOT EXISTS apply_error_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_recommendation_generation_jobs_terminal_unapplied
    ON recommendation_generation_jobs(status, updated_at DESC)
    WHERE status = 'succeeded' AND result_applied_at IS NULL;
