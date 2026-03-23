CREATE TABLE IF NOT EXISTS ai_insights_cache (
    tmdb_id integer NOT NULL CHECK (tmdb_id > 0),
    media_type text NOT NULL CHECK (media_type IN ('movie', 'tv')),
    locale text NOT NULL CHECK (char_length(locale) >= 2 AND char_length(locale) <= 35),
    generation_version text NOT NULL CHECK (char_length(btrim(generation_version)) >= 1),
    model_name text NOT NULL CHECK (char_length(btrim(model_name)) >= 1),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    generated_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tmdb_id, media_type, locale, generation_version)
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_cache_profile
    ON ai_insights_cache(generated_by_profile_id, updated_at DESC);
