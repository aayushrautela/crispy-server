INSERT INTO provider_import_connections (
    profile_id,
    provider,
    status,
    provider_user_id,
    external_username,
    credentials_json,
    created_by_user_id,
    expires_at,
    last_used_at,
    created_at,
    updated_at
)
SELECT
    legacy.profile_id,
    legacy.provider,
    'connected',
    NULL,
    NULL,
    jsonb_strip_nulls(jsonb_build_object(
        'accessToken', legacy.access_token,
        'refreshToken', legacy.refresh_token,
        'accessTokenExpiresAt', CASE
            WHEN legacy.token_expires_at IS NULL THEN NULL
            ELSE to_char(legacy.token_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        END,
        'connectedAt', to_char(legacy.connected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'lastRefreshAt', to_char(legacy.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )),
    profile_groups.owner_user_id,
    NULL,
    legacy.connected_at,
    legacy.connected_at,
    legacy.updated_at
FROM provider_accounts AS legacy
INNER JOIN profiles ON profiles.id = legacy.profile_id
INNER JOIN profile_groups ON profile_groups.id = profiles.profile_group_id
WHERE EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'provider_accounts'
)
AND NOT EXISTS (
    SELECT 1
    FROM provider_import_connections AS existing
    WHERE existing.profile_id = legacy.profile_id
      AND existing.provider = legacy.provider
      AND existing.status = 'connected'
);

DROP TABLE IF EXISTS provider_accounts CASCADE;

ALTER TABLE provider_import_connections RENAME TO provider_accounts;
ALTER INDEX IF EXISTS idx_provider_import_connections_profile_created RENAME TO idx_provider_accounts_profile_created;

ALTER TABLE provider_accounts DROP CONSTRAINT IF EXISTS provider_import_connections_provider_check;

WITH ranked_connected AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY profile_id
            ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS connection_rank
    FROM provider_accounts
    WHERE status = 'connected'
)
UPDATE provider_accounts AS accounts
SET status = 'revoked',
    state_token = NULL,
    expires_at = NULL,
    updated_at = now()
FROM ranked_connected
WHERE accounts.id = ranked_connected.id
  AND ranked_connected.connection_rank > 1;

DROP INDEX IF EXISTS idx_provider_accounts_one_connected_per_profile;
CREATE UNIQUE INDEX idx_provider_accounts_one_connected_per_profile
    ON provider_accounts(profile_id)
    WHERE status = 'connected';

CREATE INDEX IF NOT EXISTS idx_provider_accounts_pending_state
    ON provider_accounts(provider, state_token, created_at DESC)
    WHERE status = 'pending' AND state_token IS NOT NULL;

ALTER TABLE provider_import_jobs DROP CONSTRAINT IF EXISTS provider_import_jobs_provider_check;
ALTER TABLE provider_import_jobs RENAME COLUMN connection_id TO provider_account_id;

ALTER TABLE profile_watch_data_state DROP CONSTRAINT IF EXISTS profile_watch_data_state_last_import_provider_check;
ALTER TABLE profile_watch_data_state DROP CONSTRAINT IF EXISTS chk_profile_watch_data_state_current_origin;
UPDATE profile_watch_data_state
SET current_origin = 'provider_import'
WHERE current_origin IN ('trakt_import', 'simkl_import');
ALTER TABLE profile_watch_data_state ALTER COLUMN current_origin SET DEFAULT 'native';
ALTER TABLE profile_watch_data_state
    ADD CONSTRAINT chk_profile_watch_data_state_current_origin
    CHECK (current_origin IN ('native', 'provider_import'));

ALTER TABLE profile_playable_state ADD COLUMN IF NOT EXISTS source_provider text;
ALTER TABLE profile_watch_override ADD COLUMN IF NOT EXISTS source_provider text;
ALTER TABLE profile_watchlist_state ADD COLUMN IF NOT EXISTS source_provider text;
ALTER TABLE profile_rating_state ADD COLUMN IF NOT EXISTS source_provider text;
ALTER TABLE profile_play_history ADD COLUMN IF NOT EXISTS source_provider text;

UPDATE profile_playable_state SET source_provider = 'trakt' WHERE source_kind = 'trakt_pull' AND source_provider IS NULL;
UPDATE profile_watch_override SET source_provider = 'trakt' WHERE source_kind = 'trakt_pull' AND source_provider IS NULL;
UPDATE profile_watchlist_state SET source_provider = 'trakt' WHERE source_kind = 'trakt_pull' AND source_provider IS NULL;
UPDATE profile_rating_state SET source_provider = 'trakt' WHERE source_kind = 'trakt_pull' AND source_provider IS NULL;
UPDATE profile_play_history SET source_provider = 'trakt' WHERE source_kind = 'trakt_pull' AND source_provider IS NULL;

ALTER TABLE profile_playable_state DROP CONSTRAINT IF EXISTS profile_playable_state_source_kind_check;
ALTER TABLE profile_watch_override DROP CONSTRAINT IF EXISTS profile_watch_override_source_kind_check;
ALTER TABLE profile_watchlist_state DROP CONSTRAINT IF EXISTS profile_watchlist_state_source_kind_check;
ALTER TABLE profile_rating_state DROP CONSTRAINT IF EXISTS profile_rating_state_source_kind_check;
ALTER TABLE profile_play_history DROP CONSTRAINT IF EXISTS profile_play_history_source_kind_check;

ALTER TABLE profile_playable_state DROP CONSTRAINT IF EXISTS chk_profile_playable_state_source_kind;
ALTER TABLE profile_playable_state DROP CONSTRAINT IF EXISTS chk_profile_playable_state_source_provider;
ALTER TABLE profile_watch_override DROP CONSTRAINT IF EXISTS chk_profile_watch_override_source_kind;
ALTER TABLE profile_watch_override DROP CONSTRAINT IF EXISTS chk_profile_watch_override_source_provider;
ALTER TABLE profile_watchlist_state DROP CONSTRAINT IF EXISTS chk_profile_watchlist_state_source_kind;
ALTER TABLE profile_watchlist_state DROP CONSTRAINT IF EXISTS chk_profile_watchlist_state_source_provider;
ALTER TABLE profile_rating_state DROP CONSTRAINT IF EXISTS chk_profile_rating_state_source_kind;
ALTER TABLE profile_rating_state DROP CONSTRAINT IF EXISTS chk_profile_rating_state_source_provider;
ALTER TABLE profile_play_history DROP CONSTRAINT IF EXISTS chk_profile_play_history_source_kind;
ALTER TABLE profile_play_history DROP CONSTRAINT IF EXISTS chk_profile_play_history_source_provider;

UPDATE profile_playable_state SET source_kind = 'provider_import' WHERE source_kind = 'trakt_pull';
UPDATE profile_watch_override SET source_kind = 'provider_import' WHERE source_kind = 'trakt_pull';
UPDATE profile_watchlist_state SET source_kind = 'provider_import' WHERE source_kind = 'trakt_pull';
UPDATE profile_rating_state SET source_kind = 'provider_import' WHERE source_kind = 'trakt_pull';
UPDATE profile_play_history SET source_kind = 'provider_import' WHERE source_kind = 'trakt_pull';

ALTER TABLE profile_playable_state
    ADD CONSTRAINT chk_profile_playable_state_source_kind
    CHECK (source_kind IN ('local', 'provider_import', 'system')),
    ADD CONSTRAINT chk_profile_playable_state_source_provider
    CHECK ((source_kind = 'provider_import' AND source_provider IS NOT NULL) OR (source_kind <> 'provider_import' AND source_provider IS NULL));

ALTER TABLE profile_watch_override
    ADD CONSTRAINT chk_profile_watch_override_source_kind
    CHECK (source_kind IN ('local', 'provider_import', 'system')),
    ADD CONSTRAINT chk_profile_watch_override_source_provider
    CHECK ((source_kind = 'provider_import' AND source_provider IS NOT NULL) OR (source_kind <> 'provider_import' AND source_provider IS NULL));

ALTER TABLE profile_watchlist_state
    ADD CONSTRAINT chk_profile_watchlist_state_source_kind
    CHECK (source_kind IN ('local', 'provider_import', 'system')),
    ADD CONSTRAINT chk_profile_watchlist_state_source_provider
    CHECK ((source_kind = 'provider_import' AND source_provider IS NOT NULL) OR (source_kind <> 'provider_import' AND source_provider IS NULL));

ALTER TABLE profile_rating_state
    ADD CONSTRAINT chk_profile_rating_state_source_kind
    CHECK (source_kind IN ('local', 'provider_import', 'system')),
    ADD CONSTRAINT chk_profile_rating_state_source_provider
    CHECK ((source_kind = 'provider_import' AND source_provider IS NOT NULL) OR (source_kind <> 'provider_import' AND source_provider IS NULL));

ALTER TABLE profile_play_history
    ADD CONSTRAINT chk_profile_play_history_source_kind
    CHECK (source_kind IN ('local', 'provider_import', 'system')),
    ADD CONSTRAINT chk_profile_play_history_source_provider
    CHECK ((source_kind = 'provider_import' AND source_provider IS NOT NULL) OR (source_kind <> 'provider_import' AND source_provider IS NULL));

DROP TABLE IF EXISTS provider_stream_state CASCADE;
DROP TABLE IF EXISTS provider_outbox CASCADE;
DROP TABLE IF EXISTS trakt_history_shadow CASCADE;
DROP TABLE IF EXISTS trakt_watchlist_shadow CASCADE;
DROP TABLE IF EXISTS trakt_rating_shadow CASCADE;
DROP TABLE IF EXISTS trakt_progress_shadow CASCADE;
DROP TABLE IF EXISTS provider_unresolved_objects CASCADE;

CREATE TABLE provider_stream_state (
    provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    stream text NOT NULL CHECK (stream IN ('history', 'watchlist', 'ratings', 'progress')),
    remote_cursor text,
    last_remote_activity_at timestamptz,
    last_success_at timestamptz,
    last_error_at timestamptz,
    status text NOT NULL DEFAULT 'idle',
    lease_owner text,
    lease_expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_account_id, stream)
);

CREATE TABLE provider_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    stream text NOT NULL CHECK (stream IN ('history', 'watchlist', 'ratings', 'progress')),
    action text NOT NULL,
    content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    title_content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    play_history_id uuid REFERENCES profile_play_history(id) ON DELETE SET NULL,
    coalesce_key text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL CHECK (status IN ('pending', 'running', 'acked', 'failed', 'dead')) DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    acked_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_outbox_pending
    ON provider_outbox(status, available_at, created_at)
    WHERE status IN ('pending', 'failed');

CREATE TABLE provider_history_shadow (
    provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    remote_object_key text NOT NULL,
    content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    title_content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    provider_state_hash text,
    provider_synced_at timestamptz,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_account_id, remote_object_key)
);

CREATE TABLE provider_watchlist_shadow (
    provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    remote_object_key text NOT NULL,
    title_content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    provider_state_hash text,
    provider_synced_at timestamptz,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_account_id, remote_object_key)
);

CREATE TABLE provider_rating_shadow (
    provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    remote_object_key text NOT NULL,
    title_content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    provider_state_hash text,
    provider_synced_at timestamptz,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_account_id, remote_object_key)
);

CREATE TABLE provider_progress_shadow (
    provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    remote_object_key text NOT NULL,
    content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    title_content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    provider_state_hash text,
    provider_synced_at timestamptz,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_account_id, remote_object_key)
);

CREATE TABLE provider_unresolved_objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    stream text NOT NULL CHECK (stream IN ('history', 'watchlist', 'ratings', 'progress')),
    remote_object_key text NOT NULL,
    content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    title_content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_unresolved_objects_account_stream
    ON provider_unresolved_objects(provider_account_id, stream, created_at DESC);
