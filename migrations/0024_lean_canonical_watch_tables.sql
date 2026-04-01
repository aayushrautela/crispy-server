ALTER TABLE watch_history_latest
    DROP COLUMN IF EXISTS details_title_media_type,
    DROP COLUMN IF EXISTS playback_media_type,
    DROP COLUMN IF EXISTS playback_provider,
    DROP COLUMN IF EXISTS playback_provider_id,
    DROP COLUMN IF EXISTS playback_parent_provider,
    DROP COLUMN IF EXISTS playback_parent_provider_id,
    DROP COLUMN IF EXISTS playback_season_number,
    DROP COLUMN IF EXISTS playback_episode_number,
    DROP COLUMN IF EXISTS playback_absolute_episode_number,
    DROP COLUMN IF EXISTS details_still_url,
    DROP COLUMN IF EXISTS details_release_year,
    DROP COLUMN IF EXISTS details_runtime_minutes,
    DROP COLUMN IF EXISTS details_rating,
    DROP COLUMN IF EXISTS episode_title,
    DROP COLUMN IF EXISTS episode_air_date,
    DROP COLUMN IF EXISTS episode_runtime_minutes,
    DROP COLUMN IF EXISTS episode_still_url,
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS subtitle,
    DROP COLUMN IF EXISTS poster_url,
    DROP COLUMN IF EXISTS backdrop_url;

ALTER TABLE watchlist_items
    DROP COLUMN IF EXISTS details_title_media_type,
    DROP COLUMN IF EXISTS playback_media_type,
    DROP COLUMN IF EXISTS playback_provider,
    DROP COLUMN IF EXISTS playback_provider_id,
    DROP COLUMN IF EXISTS playback_parent_provider,
    DROP COLUMN IF EXISTS playback_parent_provider_id,
    DROP COLUMN IF EXISTS playback_season_number,
    DROP COLUMN IF EXISTS playback_episode_number,
    DROP COLUMN IF EXISTS playback_absolute_episode_number,
    DROP COLUMN IF EXISTS details_still_url,
    DROP COLUMN IF EXISTS details_release_year,
    DROP COLUMN IF EXISTS details_runtime_minutes,
    DROP COLUMN IF EXISTS details_rating,
    DROP COLUMN IF EXISTS episode_title,
    DROP COLUMN IF EXISTS episode_air_date,
    DROP COLUMN IF EXISTS episode_runtime_minutes,
    DROP COLUMN IF EXISTS episode_still_url,
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS subtitle,
    DROP COLUMN IF EXISTS poster_url,
    DROP COLUMN IF EXISTS backdrop_url;

ALTER TABLE ratings
    DROP COLUMN IF EXISTS details_title_media_type,
    DROP COLUMN IF EXISTS playback_media_type,
    DROP COLUMN IF EXISTS playback_provider,
    DROP COLUMN IF EXISTS playback_provider_id,
    DROP COLUMN IF EXISTS playback_parent_provider,
    DROP COLUMN IF EXISTS playback_parent_provider_id,
    DROP COLUMN IF EXISTS playback_season_number,
    DROP COLUMN IF EXISTS playback_episode_number,
    DROP COLUMN IF EXISTS playback_absolute_episode_number,
    DROP COLUMN IF EXISTS details_still_url,
    DROP COLUMN IF EXISTS details_release_year,
    DROP COLUMN IF EXISTS details_runtime_minutes,
    DROP COLUMN IF EXISTS details_rating,
    DROP COLUMN IF EXISTS episode_title,
    DROP COLUMN IF EXISTS episode_air_date,
    DROP COLUMN IF EXISTS episode_runtime_minutes,
    DROP COLUMN IF EXISTS episode_still_url,
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS subtitle,
    DROP COLUMN IF EXISTS poster_url,
    DROP COLUMN IF EXISTS backdrop_url;

ALTER TABLE media_progress
    DROP COLUMN IF EXISTS details_title_media_type,
    DROP COLUMN IF EXISTS playback_media_type,
    DROP COLUMN IF EXISTS playback_provider,
    DROP COLUMN IF EXISTS playback_provider_id,
    DROP COLUMN IF EXISTS playback_parent_provider,
    DROP COLUMN IF EXISTS playback_parent_provider_id,
    DROP COLUMN IF EXISTS playback_season_number,
    DROP COLUMN IF EXISTS playback_episode_number,
    DROP COLUMN IF EXISTS playback_absolute_episode_number,
    DROP COLUMN IF EXISTS details_still_url,
    DROP COLUMN IF EXISTS details_release_year,
    DROP COLUMN IF EXISTS details_runtime_minutes,
    DROP COLUMN IF EXISTS details_rating,
    DROP COLUMN IF EXISTS episode_title,
    DROP COLUMN IF EXISTS episode_air_date,
    DROP COLUMN IF EXISTS episode_runtime_minutes,
    DROP COLUMN IF EXISTS episode_still_url,
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS subtitle,
    DROP COLUMN IF EXISTS poster_url,
    DROP COLUMN IF EXISTS backdrop_url;

DROP INDEX IF EXISTS idx_watch_history_latest_profile_watched_at;
CREATE INDEX IF NOT EXISTS idx_watch_history_latest_profile_watched_at
    ON watch_history_latest(profile_id, watched_at DESC, media_key DESC);

DROP INDEX IF EXISTS idx_watchlist_profile_added_at;
CREATE INDEX IF NOT EXISTS idx_watchlist_profile_added_at
    ON watchlist_items(profile_id, added_at DESC, media_key DESC);

DROP INDEX IF EXISTS idx_ratings_profile_rated_at;
CREATE INDEX IF NOT EXISTS idx_ratings_profile_rated_at
    ON ratings(profile_id, rated_at DESC, media_key DESC);
