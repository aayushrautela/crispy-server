DROP INDEX IF EXISTS idx_recommendation_generation_jobs_status_poll;

ALTER TABLE recommendation_generation_jobs
    ADD COLUMN IF NOT EXISTS trigger_source text NOT NULL DEFAULT 'system',
    ADD COLUMN IF NOT EXISTS last_requested_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS next_run_at timestamptz,
    ADD COLUMN IF NOT EXISTS lease_owner text,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

UPDATE recommendation_generation_jobs
SET last_requested_at = COALESCE(last_requested_at, created_at, now()),
    next_run_at = COALESCE(next_run_at, next_poll_at, created_at, now());

UPDATE recommendation_generation_jobs
SET status = 'pending',
    worker_job_id = NULL,
    accepted_at = NULL,
    started_at = NULL,
    cancelled_at = NULL,
    next_run_at = now(),
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = now()
WHERE status IN ('pending', 'queued', 'running');

ALTER TABLE recommendation_generation_jobs
    ALTER COLUMN next_run_at SET NOT NULL;

ALTER TABLE recommendation_generation_jobs
    DROP COLUMN IF EXISTS next_poll_at;

CREATE INDEX IF NOT EXISTS idx_recommendation_generation_jobs_status_run
    ON recommendation_generation_jobs(status, next_run_at ASC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendation_generation_jobs_lease
    ON recommendation_generation_jobs(status, lease_expires_at ASC)
    WHERE status IN ('pending', 'queued', 'running');
