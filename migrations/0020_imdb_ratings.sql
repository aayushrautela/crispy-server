CREATE TABLE IF NOT EXISTS imdb_ratings (
    imdb_id text PRIMARY KEY CHECK (imdb_id ~ '^tt[0-9]+$'),
    rating numeric(3,1) NOT NULL,
    votes integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imdb_ratings_updated_at ON imdb_ratings (updated_at);
