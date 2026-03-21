CREATE TABLE IF NOT EXISTS tmdb_titles (
    media_type text NOT NULL,
    tmdb_id integer NOT NULL,
    name text,
    original_name text,
    overview text,
    release_date date,
    first_air_date date,
    status text,
    poster_path text,
    backdrop_path text,
    runtime integer,
    episode_run_time jsonb NOT NULL DEFAULT '[]'::jsonb,
    number_of_seasons integer,
    number_of_episodes integer,
    external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (media_type, tmdb_id)
);

CREATE INDEX IF NOT EXISTS idx_tmdb_titles_expires_at ON tmdb_titles(expires_at);

CREATE TABLE IF NOT EXISTS tmdb_tv_seasons (
    show_tmdb_id integer NOT NULL,
    season_number integer NOT NULL,
    name text,
    overview text,
    air_date date,
    poster_path text,
    episode_count integer,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (show_tmdb_id, season_number)
);

CREATE INDEX IF NOT EXISTS idx_tmdb_tv_seasons_expires_at ON tmdb_tv_seasons(expires_at);

CREATE TABLE IF NOT EXISTS tmdb_tv_episodes (
    show_tmdb_id integer NOT NULL,
    season_number integer NOT NULL,
    episode_number integer NOT NULL,
    tmdb_id integer,
    name text,
    overview text,
    air_date date,
    runtime integer,
    still_path text,
    vote_average numeric(5,2),
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (show_tmdb_id, season_number, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_tmdb_tv_episodes_air_date ON tmdb_tv_episodes(show_tmdb_id, air_date);
CREATE INDEX IF NOT EXISTS idx_tmdb_tv_episodes_expires_at ON tmdb_tv_episodes(expires_at);

CREATE TABLE IF NOT EXISTS profile_tracked_series (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    show_tmdb_id integer NOT NULL,
    reason text NOT NULL,
    last_source_event_id uuid REFERENCES watch_events(id) ON DELETE SET NULL,
    last_interacted_at timestamptz NOT NULL,
    next_episode_air_date date,
    metadata_refreshed_at timestamptz,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (profile_id, show_tmdb_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_tracked_series_next_air ON profile_tracked_series(profile_id, next_episode_air_date);
