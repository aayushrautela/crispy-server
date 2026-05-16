-- Create the three tables the code expects but were missing from 0065.
-- 0065 created domain tables (user_state.provider_connections, user_state.provider_import_batches) with different schemas,
-- but the code still uses the original table structures. These tables match what provider-sessions.repo.ts,
-- provider-import-jobs.repo.ts, and profile-watch-data-state.repo.ts query.

CREATE TABLE IF NOT EXISTS user_state.provider_sessions (
  profile_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('trakt', 'simkl')),
  state text NOT NULL CHECK (state IN ('not_connected', 'oauth_pending', 'connected', 'reauth_required', 'disconnected_by_user')),
  provider_user_id text NULL,
  external_username text NULL,
  credentials_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_token text NULL,
  expires_at timestamptz NULL,
  last_refresh_at timestamptz NULL,
  last_refresh_error text NULL,
  last_import_completed_at timestamptz NULL,
  disconnected_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, provider)
);

CREATE TABLE IF NOT EXISTS user_state.provider_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  profile_group_id text NOT NULL DEFAULT '',
  provider text NOT NULL,
  mode text NOT NULL DEFAULT 'replace_import',
  status text NOT NULL,
  requested_by_user_id uuid NOT NULL,
  checkpoint_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_import_jobs_profile ON user_state.provider_import_jobs (profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_state.profile_watch_data_state (
  profile_id uuid PRIMARY KEY,
  history_generation integer NOT NULL DEFAULT 0,
  current_origin text NOT NULL DEFAULT 'native',
  last_import_provider text NULL,
  last_import_job_id uuid NULL,
  last_reset_at timestamptz NULL,
  last_import_completed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
