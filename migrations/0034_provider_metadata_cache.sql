CREATE TABLE IF NOT EXISTS tvdb_title_bundles (
    provider_id text PRIMARY KEY,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tvdb_title_bundles_expires_at
    ON tvdb_title_bundles(expires_at);

CREATE TABLE IF NOT EXISTS kitsu_title_bundles (
    provider_id text PRIMARY KEY,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kitsu_title_bundles_expires_at
    ON kitsu_title_bundles(expires_at);
