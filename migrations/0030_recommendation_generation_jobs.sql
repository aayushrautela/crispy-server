CREATE TABLE IF NOT EXISTS recommendation_generation_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    source_key text NOT NULL,
    algorithm_version text NOT NULL,
    history_generation integer NOT NULL,
    idempotency_key text NOT NULL,
    worker_job_id text,
    status text NOT NULL CHECK (status IN ('pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled')),
    request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_status_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    failure_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    submit_attempts integer NOT NULL DEFAULT 0,
    poll_attempts integer NOT NULL DEFAULT 0,
    poll_error_count integer NOT NULL DEFAULT 0,
    accepted_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    last_submitted_at timestamptz,
    last_polled_at timestamptz,
    next_poll_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (idempotency_key),
    UNIQUE (profile_id, source_key, algorithm_version, history_generation)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_generation_jobs_status_poll
    ON recommendation_generation_jobs(status, next_poll_at ASC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendation_generation_jobs_profile_created
    ON recommendation_generation_jobs(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendation_generation_jobs_worker_job_id
    ON recommendation_generation_jobs(worker_job_id)
    WHERE worker_job_id IS NOT NULL;
