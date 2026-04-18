ALTER TABLE recommendation_generation_jobs
    DROP CONSTRAINT IF EXISTS recommendation_generation_jobs_next_run_at_state_check;

DROP INDEX IF EXISTS idx_recommendation_generation_jobs_status_run;
DROP INDEX IF EXISTS idx_recommendation_generation_jobs_lease;

ALTER TABLE recommendation_generation_jobs
    DROP COLUMN IF EXISTS next_run_at,
    DROP COLUMN IF EXISTS lease_owner,
    DROP COLUMN IF EXISTS lease_expires_at;
