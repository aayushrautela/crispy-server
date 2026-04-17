ALTER TABLE recommendation_generation_jobs
    ALTER COLUMN next_run_at DROP NOT NULL;

UPDATE recommendation_generation_jobs
SET next_run_at = COALESCE(next_run_at, now()),
    updated_at = now()
WHERE status IN ('pending', 'queued', 'running')
  AND next_run_at IS NULL;

UPDATE recommendation_generation_jobs
SET next_run_at = NULL,
    updated_at = now()
WHERE status IN ('succeeded', 'failed', 'cancelled')
  AND next_run_at IS NOT NULL;

ALTER TABLE recommendation_generation_jobs
    DROP CONSTRAINT IF EXISTS recommendation_generation_jobs_next_run_at_state_check;

ALTER TABLE recommendation_generation_jobs
    ADD CONSTRAINT recommendation_generation_jobs_next_run_at_state_check
    CHECK (
        (status IN ('pending', 'queued', 'running') AND next_run_at IS NOT NULL)
        OR (status IN ('succeeded', 'failed', 'cancelled') AND next_run_at IS NULL)
    );
