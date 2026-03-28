ALTER TABLE profile_tracked_series
    ADD COLUMN tracked_media_key text,
    ADD COLUMN tracked_media_type text,
    ADD COLUMN provider text,
    ADD COLUMN provider_id text;

UPDATE profile_tracked_series
SET tracked_media_key = CONCAT('show:tmdb:', show_tmdb_id),
    tracked_media_type = 'show',
    provider = 'tmdb',
    provider_id = show_tmdb_id::text
WHERE tracked_media_key IS NULL;

ALTER TABLE profile_tracked_series
    ALTER COLUMN tracked_media_key SET NOT NULL,
    ALTER COLUMN tracked_media_type SET NOT NULL,
    ALTER COLUMN provider SET NOT NULL,
    ALTER COLUMN provider_id SET NOT NULL,
    ADD CONSTRAINT profile_tracked_series_media_type_check CHECK (tracked_media_type IN ('show', 'anime')),
    ADD CONSTRAINT profile_tracked_series_provider_check CHECK (provider IN ('tmdb', 'tvdb', 'kitsu'));

ALTER TABLE profile_tracked_series
    DROP CONSTRAINT profile_tracked_series_pkey,
    ALTER COLUMN show_tmdb_id DROP NOT NULL,
    ADD PRIMARY KEY (profile_id, tracked_media_key);

DROP INDEX IF EXISTS idx_profile_tracked_series_next_air;
CREATE INDEX IF NOT EXISTS idx_profile_tracked_series_next_air
    ON profile_tracked_series(profile_id, next_episode_air_date, last_interacted_at DESC);
