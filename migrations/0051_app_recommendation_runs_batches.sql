CREATE TABLE IF NOT EXISTS app_recommendation_runs (
  run_id uuid PRIMARY KEY,
  app_id text NOT NULL REFERENCES app_registry(app_id),
  purpose text NOT NULL,
  run_type text NOT NULL CHECK (run_type IN ('incremental', 'snapshot', 'backfill', 'full_refresh')),
  status text NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
  model_version text,
  algorithm text,
  input jsonb,
  output jsonb,
  metadata jsonb,
  error jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_app_recommendation_runs_app_status_created
  ON app_recommendation_runs(app_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS app_recommendation_batches (
  batch_id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES app_recommendation_runs(run_id) ON DELETE CASCADE,
  app_id text NOT NULL REFERENCES app_registry(app_id),
  status text NOT NULL CHECK (status IN ('leased', 'running', 'completed', 'failed', 'cancelled', 'expired')),
  snapshot_id uuid REFERENCES eligible_profile_snapshots(snapshot_id),
  lease_id uuid,
  lease_expires_at timestamptz,
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  items jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_recommendation_batches_run_app_unique UNIQUE (run_id, app_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_app_recommendation_batches_app_run_status
  ON app_recommendation_batches(app_id, run_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_recommendation_batches_lease
  ON app_recommendation_batches(app_id, status, lease_expires_at)
  WHERE lease_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_recommendation_backfill_assignments (
  assignment_id uuid PRIMARY KEY,
  app_id text NOT NULL REFERENCES app_registry(app_id),
  snapshot_id uuid NOT NULL REFERENCES eligible_profile_snapshots(snapshot_id),
  status text NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'expired')),
  priority integer NOT NULL DEFAULT 0,
  estimated_profile_count integer NOT NULL DEFAULT 0 CHECK (estimated_profile_count >= 0),
  profiles_completed integer NOT NULL DEFAULT 0 CHECK (profiles_completed >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_app_recommendation_backfill_app_status_priority
  ON app_recommendation_backfill_assignments(app_id, status, priority DESC, created_at ASC);
