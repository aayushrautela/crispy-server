CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_tmdb_titles_name_trgm
    ON tmdb_titles USING gin (lower(coalesce(name, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tmdb_titles_original_name_trgm
    ON tmdb_titles USING gin (lower(coalesce(original_name, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_watch_history_profile_show_episode
    ON watch_history(profile_id, show_tmdb_id)
    WHERE media_type = 'episode';

CREATE INDEX IF NOT EXISTS idx_profile_tracked_series_profile_next_air_last_interacted
    ON profile_tracked_series(
        profile_id,
        COALESCE(next_episode_air_date, DATE '9999-12-31'),
        last_interacted_at DESC
    );
