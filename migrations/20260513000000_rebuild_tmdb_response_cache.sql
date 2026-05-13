DROP TABLE IF EXISTS tmdb_api_responses CASCADE;
DROP TABLE IF EXISTS tmdb_search_cache CASCADE;
DROP TABLE IF EXISTS tmdb_people CASCADE;
DROP TABLE IF EXISTS tmdb_collections CASCADE;
DROP TABLE IF EXISTS tmdb_tv_episodes CASCADE;
DROP TABLE IF EXISTS tmdb_tv_seasons CASCADE;
DROP TABLE IF EXISTS tmdb_external_ids CASCADE;
DROP TABLE IF EXISTS tmdb_titles CASCADE;

CREATE TABLE tmdb_api_responses (
    cache_key text PRIMARY KEY,
    resource_type text NOT NULL,
    resource_id text,
    variant text NOT NULL,
    language text,
    request_path text NOT NULL,
    request_query jsonb NOT NULL DEFAULT '{}'::jsonb,
    response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    status_code integer NOT NULL,
    is_negative boolean NOT NULL DEFAULT false,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    fresh_until timestamptz NOT NULL,
    stale_until timestamptz NOT NULL,
    purge_at timestamptz NOT NULL,
    last_error text,
    error_count integer NOT NULL DEFAULT 0,
    CHECK (fresh_until <= stale_until),
    CHECK (stale_until <= purge_at)
);

CREATE INDEX idx_tmdb_api_responses_resource ON tmdb_api_responses(resource_type, resource_id, variant);
CREATE INDEX idx_tmdb_api_responses_fresh_until ON tmdb_api_responses(fresh_until);
CREATE INDEX idx_tmdb_api_responses_stale_until ON tmdb_api_responses(stale_until);
CREATE INDEX idx_tmdb_api_responses_purge_at ON tmdb_api_responses(purge_at);

CREATE TABLE tmdb_titles (
    media_type text NOT NULL CHECK (media_type IN ('movie', 'tv')),
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

CREATE INDEX idx_tmdb_titles_name ON tmdb_titles(lower(coalesce(name, '')));
CREATE INDEX idx_tmdb_titles_original_name ON tmdb_titles(lower(coalesce(original_name, '')));
CREATE INDEX idx_tmdb_titles_expires_at ON tmdb_titles(expires_at);

CREATE TABLE tmdb_tv_seasons (
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

CREATE INDEX idx_tmdb_tv_seasons_expires_at ON tmdb_tv_seasons(expires_at);

CREATE TABLE tmdb_tv_episodes (
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

CREATE INDEX idx_tmdb_tv_episodes_air_date ON tmdb_tv_episodes(show_tmdb_id, air_date);
CREATE INDEX idx_tmdb_tv_episodes_expires_at ON tmdb_tv_episodes(expires_at);

CREATE TABLE tmdb_external_ids (
    source text NOT NULL,
    external_id text NOT NULL,
    media_type text NOT NULL,
    tmdb_id integer NOT NULL,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, external_id, media_type)
);

CREATE INDEX idx_tmdb_external_ids_tmdb ON tmdb_external_ids(media_type, tmdb_id);

CREATE TABLE tmdb_people (
    tmdb_person_id integer PRIMARY KEY,
    name text NOT NULL,
    known_for_department text,
    profile_path text,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX idx_tmdb_people_name ON tmdb_people(lower(name));
CREATE INDEX idx_tmdb_people_expires_at ON tmdb_people(expires_at);

CREATE TABLE tmdb_collections (
    tmdb_collection_id integer PRIMARY KEY,
    name text,
    poster_path text,
    backdrop_path text,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX idx_tmdb_collections_expires_at ON tmdb_collections(expires_at);

CREATE TABLE tmdb_search_cache (
    cache_key text PRIMARY KEY REFERENCES tmdb_api_responses(cache_key) ON DELETE CASCADE,
    search_type text NOT NULL,
    query text NOT NULL,
    media_type text,
    language text,
    page integer NOT NULL DEFAULT 1,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX idx_tmdb_search_cache_lookup ON tmdb_search_cache(search_type, lower(query), media_type, language, page);
CREATE INDEX idx_tmdb_search_cache_expires_at ON tmdb_search_cache(expires_at);
