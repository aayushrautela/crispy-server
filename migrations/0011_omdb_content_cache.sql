CREATE TABLE IF NOT EXISTS omdb_content_cache (
    imdb_id text PRIMARY KEY CHECK (imdb_id ~ '^tt[0-9]+$'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    fetched_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
