CREATE TABLE IF NOT EXISTS profile_watch_clock (
    profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    next_mutation_seq bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_playable_state (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    title_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    playback_status text NOT NULL CHECK (playback_status IN ('idle', 'in_progress', 'completed', 'dismissed')),
    position_seconds integer NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
    duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds > 0),
    progress_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    play_count integer NOT NULL DEFAULT 0 CHECK (play_count >= 0),
    first_completed_at timestamptz,
    last_completed_at timestamptz,
    last_activity_at timestamptz NOT NULL,
    dismissed_at timestamptz,
    last_mutation_seq bigint NOT NULL,
    source_kind text NOT NULL CHECK (source_kind IN ('local', 'trakt_pull', 'system')),
    source_updated_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_playable_state_profile_title
    ON profile_playable_state(profile_id, title_content_id);

CREATE INDEX IF NOT EXISTS idx_profile_playable_state_in_progress
    ON profile_playable_state(profile_id, last_activity_at DESC)
    WHERE playback_status = 'in_progress';

CREATE TABLE IF NOT EXISTS profile_watch_override (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    target_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    target_kind text NOT NULL CHECK (target_kind IN ('movie', 'episode', 'show', 'anime')),
    override_state text NOT NULL CHECK (override_state IN ('watched', 'unwatched')),
    scope text NOT NULL CHECK (scope IN ('self', 'released_descendants')),
    applies_through_release_at timestamptz,
    last_mutation_seq bigint NOT NULL,
    source_kind text NOT NULL CHECK (source_kind IN ('local', 'trakt_pull', 'system')),
    source_updated_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, target_content_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_watch_override_profile_updated
    ON profile_watch_override(profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS profile_watchlist_state (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    target_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    target_kind text NOT NULL CHECK (target_kind IN ('movie', 'show', 'anime')),
    present boolean NOT NULL,
    added_at timestamptz,
    removed_at timestamptz,
    last_mutation_seq bigint NOT NULL,
    source_kind text NOT NULL CHECK (source_kind IN ('local', 'trakt_pull', 'system')),
    source_updated_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, target_content_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_watchlist_state_present
    ON profile_watchlist_state(profile_id, updated_at DESC)
    WHERE present = true;

CREATE TABLE IF NOT EXISTS profile_rating_state (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    target_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    target_kind text NOT NULL CHECK (target_kind IN ('movie', 'show', 'anime')),
    rating smallint CHECK (rating IS NULL OR (rating >= 1 AND rating <= 10)),
    rated_at timestamptz,
    removed_at timestamptz,
    last_mutation_seq bigint NOT NULL,
    source_kind text NOT NULL CHECK (source_kind IN ('local', 'trakt_pull', 'system')),
    source_updated_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, target_content_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_rating_state_present
    ON profile_rating_state(profile_id, rated_at DESC)
    WHERE rating IS NOT NULL;

CREATE TABLE IF NOT EXISTS profile_play_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    title_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    completed_at timestamptz NOT NULL,
    last_mutation_seq bigint NOT NULL,
    source_kind text NOT NULL CHECK (source_kind IN ('local', 'trakt_pull', 'system')),
    source_remote_id text,
    client_mutation_id text,
    voided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_play_history_profile_completed
    ON profile_play_history(profile_id, completed_at DESC, id DESC)
    WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS profile_title_projection (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    title_kind text NOT NULL CHECK (title_kind IN ('movie', 'show', 'anime')),
    title_media_key text NOT NULL,
    title_media_type text NOT NULL CHECK (title_media_type IN ('movie', 'show', 'anime')),
    title_provider text NOT NULL,
    title_provider_id text NOT NULL,
    title_content_release_at timestamptz,
    title_release_year integer,
    title_runtime_minutes integer,
    title_rating numeric(5,2),
    title_text text,
    title_subtitle text,
    title_poster_url text,
    title_backdrop_url text,
    active_content_id uuid,
    active_media_key text,
    active_media_type text CHECK (active_media_type IS NULL OR active_media_type IN ('movie', 'episode')),
    active_provider text,
    active_provider_id text,
    active_parent_provider text,
    active_parent_provider_id text,
    active_season_number integer,
    active_episode_number integer,
    active_episode_title text,
    active_episode_release_at timestamptz,
    active_position_seconds integer,
    active_duration_seconds integer,
    active_progress_percent numeric(5,2),
    has_in_progress boolean NOT NULL DEFAULT false,
    effective_watched boolean NOT NULL DEFAULT false,
    last_completed_at timestamptz,
    last_watched_at timestamptz,
    watchlist_present boolean NOT NULL DEFAULT false,
    watchlist_updated_at timestamptz,
    rating_value smallint,
    rated_at timestamptz,
    dismissed_at timestamptz,
    last_activity_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, title_content_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_title_projection_last_activity
    ON profile_title_projection(profile_id, last_activity_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_profile_title_projection_last_completed
    ON profile_title_projection(profile_id, last_completed_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS profile_bulk_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    operation_type text NOT NULL CHECK (operation_type IN ('mark_title_watched', 'mark_title_unwatched')),
    title_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    cutoff_release_at timestamptz,
    status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider text NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    token_expires_at timestamptz,
    connected_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, provider)
);

CREATE TABLE IF NOT EXISTS provider_stream_state (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider text NOT NULL,
    stream text NOT NULL CHECK (stream IN ('history', 'watchlist', 'ratings', 'progress')),
    remote_cursor text,
    last_remote_activity_at timestamptz,
    last_success_at timestamptz,
    last_error_at timestamptz,
    status text NOT NULL DEFAULT 'idle',
    lease_owner text,
    lease_expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, provider, stream)
);

CREATE TABLE IF NOT EXISTS provider_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider text NOT NULL,
    stream text NOT NULL CHECK (stream IN ('history', 'watchlist', 'ratings', 'progress')),
    action text NOT NULL,
    content_id uuid,
    title_content_id uuid,
    play_history_id uuid,
    coalesce_key text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL CHECK (status IN ('pending', 'running', 'acked', 'failed', 'dead')) DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    acked_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_outbox_pending
    ON provider_outbox(status, available_at, created_at)
    WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS trakt_history_shadow (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    remote_state_hash text NOT NULL,
    remote_updated_at timestamptz,
    remote_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, content_id)
);

CREATE TABLE IF NOT EXISTS trakt_watchlist_shadow (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    remote_state_hash text NOT NULL,
    remote_updated_at timestamptz,
    remote_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, title_content_id)
);

CREATE TABLE IF NOT EXISTS trakt_rating_shadow (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    remote_state_hash text NOT NULL,
    remote_updated_at timestamptz,
    remote_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, title_content_id)
);

CREATE TABLE IF NOT EXISTS trakt_progress_shadow (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    remote_state_hash text NOT NULL,
    remote_updated_at timestamptz,
    remote_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, content_id)
);

CREATE TABLE IF NOT EXISTS provider_unresolved_objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider text NOT NULL,
    stream text NOT NULL,
    remote_object_key text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
