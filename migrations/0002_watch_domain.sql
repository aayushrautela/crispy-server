CREATE TABLE IF NOT EXISTS watch_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    client_event_id text NOT NULL,
    event_type text NOT NULL,
    media_key text NOT NULL,
    media_type text NOT NULL,
    tmdb_id integer,
    show_tmdb_id integer,
    season_number integer,
    episode_number integer,
    title text,
    subtitle text,
    poster_url text,
    backdrop_url text,
    position_seconds integer,
    duration_seconds integer,
    progress_percent numeric(5,2),
    rating smallint,
    occurred_at timestamptz NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_watch_events_profile_occurred ON watch_events(profile_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_events_profile_media ON watch_events(profile_id, media_key, occurred_at DESC);

CREATE TABLE IF NOT EXISTS media_progress (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_key text NOT NULL,
    media_type text NOT NULL,
    tmdb_id integer,
    show_tmdb_id integer,
    season_number integer,
    episode_number integer,
    title text,
    subtitle text,
    poster_url text,
    backdrop_url text,
    position_seconds integer NOT NULL DEFAULT 0,
    duration_seconds integer,
    progress_percent numeric(5,2) NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'in_progress',
    last_event_id uuid REFERENCES watch_events(id) ON DELETE SET NULL,
    last_played_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    dismissed_at timestamptz,
    next_episode_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, media_key)
);

CREATE INDEX IF NOT EXISTS idx_media_progress_profile_last_played ON media_progress(profile_id, last_played_at DESC);

CREATE TABLE IF NOT EXISTS watch_history (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_key text NOT NULL,
    media_type text NOT NULL,
    tmdb_id integer,
    show_tmdb_id integer,
    season_number integer,
    episode_number integer,
    title text,
    subtitle text,
    poster_url text,
    backdrop_url text,
    watched_at timestamptz NOT NULL,
    source_event_id uuid REFERENCES watch_events(id) ON DELETE SET NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (profile_id, media_key)
);

CREATE INDEX IF NOT EXISTS idx_watch_history_profile_watched_at ON watch_history(profile_id, watched_at DESC);

CREATE TABLE IF NOT EXISTS watchlist_items (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_key text NOT NULL,
    media_type text NOT NULL,
    tmdb_id integer,
    title text,
    subtitle text,
    poster_url text,
    backdrop_url text,
    added_at timestamptz NOT NULL,
    source_event_id uuid REFERENCES watch_events(id) ON DELETE SET NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (profile_id, media_key)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_profile_added_at ON watchlist_items(profile_id, added_at DESC);

CREATE TABLE IF NOT EXISTS ratings (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_key text NOT NULL,
    media_type text NOT NULL,
    tmdb_id integer,
    title text,
    subtitle text,
    poster_url text,
    backdrop_url text,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 10),
    rated_at timestamptz NOT NULL,
    source_event_id uuid REFERENCES watch_events(id) ON DELETE SET NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (profile_id, media_key)
);

CREATE INDEX IF NOT EXISTS idx_ratings_profile_rated_at ON ratings(profile_id, rated_at DESC);

CREATE TABLE IF NOT EXISTS continue_watching_projection (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_key text NOT NULL,
    media_type text NOT NULL,
    tmdb_id integer,
    show_tmdb_id integer,
    season_number integer,
    episode_number integer,
    title text,
    subtitle text,
    poster_url text,
    backdrop_url text,
    position_seconds integer NOT NULL DEFAULT 0,
    duration_seconds integer,
    progress_percent numeric(5,2) NOT NULL DEFAULT 0,
    last_activity_at timestamptz NOT NULL,
    dismissed_at timestamptz,
    next_episode_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, media_key)
);

CREATE INDEX IF NOT EXISTS idx_continue_watching_profile_last_activity
    ON continue_watching_projection(profile_id, last_activity_at DESC)
    WHERE dismissed_at IS NULL;
