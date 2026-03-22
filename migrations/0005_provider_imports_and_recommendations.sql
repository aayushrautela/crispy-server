CREATE TABLE IF NOT EXISTS watch_history_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    media_key text NOT NULL,
    media_type text NOT NULL,
    tmdb_id integer,
    show_tmdb_id integer,
    season_number integer,
    episode_number integer,
    watched_at timestamptz NOT NULL,
    source_watch_event_id uuid REFERENCES watch_events(id) ON DELETE SET NULL,
    source_kind text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_history_entries_profile_watched_at
    ON watch_history_entries(profile_id, watched_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS provider_import_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('trakt', 'simkl')),
    status text NOT NULL CHECK (status IN ('pending', 'connected', 'expired', 'revoked')),
    state_token text,
    provider_user_id text,
    external_username text,
    credentials_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    expires_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_import_connections_profile_created
    ON provider_import_connections(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_import_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('trakt', 'simkl')),
    mode text NOT NULL CHECK (mode IN ('replace_import')),
    status text NOT NULL CHECK (
        status IN ('oauth_pending', 'queued', 'running', 'succeeded', 'succeeded_with_warnings', 'failed', 'cancelled')
    ),
    requested_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    connection_id uuid REFERENCES provider_import_connections(id) ON DELETE SET NULL,
    checkpoint_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_import_jobs_profile_created
    ON provider_import_jobs(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_import_jobs_profile_status
    ON provider_import_jobs(profile_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS profile_watch_data_state (
    profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    history_generation integer NOT NULL DEFAULT 0,
    current_origin text NOT NULL DEFAULT 'native',
    last_import_provider text CHECK (last_import_provider IN ('trakt', 'simkl')),
    last_import_job_id uuid REFERENCES provider_import_jobs(id) ON DELETE SET NULL,
    last_reset_at timestamptz,
    last_import_completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tmdb_external_ids (
    source text NOT NULL,
    external_id text NOT NULL,
    media_type text NOT NULL,
    tmdb_id integer NOT NULL,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, external_id, media_type)
);

CREATE INDEX IF NOT EXISTS idx_tmdb_external_ids_tmdb_id
    ON tmdb_external_ids(media_type, tmdb_id);

CREATE TABLE IF NOT EXISTS recommendation_event_outbox (
    id bigserial PRIMARY KEY,
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    history_generation integer NOT NULL,
    event_type text NOT NULL,
    media_key text,
    media_type text,
    tmdb_id integer,
    show_tmdb_id integer,
    season_number integer,
    episode_number integer,
    rating smallint,
    occurred_at timestamptz NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_recommendation_outbox_profile_cursor
    ON recommendation_event_outbox(profile_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_recommendation_outbox_undelivered
    ON recommendation_event_outbox(delivered_at, id ASC)
    WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS recommendation_snapshots (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    history_generation integer NOT NULL,
    algorithm_version text NOT NULL,
    source_cursor text,
    generated_at timestamptz NOT NULL,
    expires_at timestamptz,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, algorithm_version)
);
