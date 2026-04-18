-- Tighten live schema and rebuildable caches to the TMDB-only model.

-- Normalize lingering anime title kinds to generic show semantics.
UPDATE profile_watch_override
SET target_kind = 'show'
WHERE target_kind = 'anime';

ALTER TABLE profile_watch_override
  DROP CONSTRAINT IF EXISTS profile_watch_override_target_kind_check;

ALTER TABLE profile_watch_override
  ADD CONSTRAINT profile_watch_override_target_kind_check
  CHECK (target_kind IN ('movie', 'episode', 'show'));

UPDATE profile_watchlist_state
SET target_kind = 'show'
WHERE target_kind = 'anime';

ALTER TABLE profile_watchlist_state
  DROP CONSTRAINT IF EXISTS profile_watchlist_state_target_kind_check;

ALTER TABLE profile_watchlist_state
  ADD CONSTRAINT profile_watchlist_state_target_kind_check
  CHECK (target_kind IN ('movie', 'show'));

UPDATE profile_rating_state
SET target_kind = 'show'
WHERE target_kind = 'anime';

ALTER TABLE profile_rating_state
  DROP CONSTRAINT IF EXISTS profile_rating_state_target_kind_check;

ALTER TABLE profile_rating_state
  ADD CONSTRAINT profile_rating_state_target_kind_check
  CHECK (target_kind IN ('movie', 'show'));

UPDATE profile_title_projection
SET title_kind = 'show'
WHERE title_kind = 'anime';

UPDATE profile_title_projection
SET title_media_type = 'show'
WHERE title_media_type = 'anime';

ALTER TABLE profile_title_projection
  DROP CONSTRAINT IF EXISTS profile_title_projection_title_kind_check;

ALTER TABLE profile_title_projection
  ADD CONSTRAINT profile_title_projection_title_kind_check
  CHECK (title_kind IN ('movie', 'show'));

ALTER TABLE profile_title_projection
  DROP CONSTRAINT IF EXISTS profile_title_projection_title_media_type_check;

ALTER TABLE profile_title_projection
  ADD CONSTRAINT profile_title_projection_title_media_type_check
  CHECK (title_media_type IN ('movie', 'show'));

-- Derived caches and projections should not retain stale non-TMDB rows.
DELETE FROM watch_media_card_cache
WHERE title_provider <> 'tmdb'
   OR title_media_type NOT IN ('movie', 'show')
   OR media_key LIKE 'anime:%'
   OR media_key LIKE '%:tvdb:%'
   OR media_key LIKE '%:kitsu:%';

UPDATE watch_media_card_cache
SET title_media_type = 'show'
WHERE title_media_type = 'anime';

ALTER TABLE watch_media_card_cache
  DROP CONSTRAINT IF EXISTS watch_media_card_cache_title_media_type_check;

ALTER TABLE watch_media_card_cache
  ADD CONSTRAINT watch_media_card_cache_title_media_type_check
  CHECK (title_media_type IN ('movie', 'show'));

DELETE FROM profile_episodic_follow_state
WHERE title_media_key LIKE 'anime:%'
   OR title_media_key LIKE '%:tvdb:%'
   OR title_media_key LIKE '%:kitsu:%'
   OR next_episode_media_key LIKE 'anime:%'
   OR next_episode_media_key LIKE '%:tvdb:%'
   OR next_episode_media_key LIKE '%:kitsu:%';

DO $$
BEGIN
  -- `profile_tracked_series` was removed in 0028, but some databases may still
  -- retain it if they drifted before the watch-v2 cutover.
  IF to_regclass('public.profile_tracked_series') IS NOT NULL THEN
    UPDATE profile_tracked_series
    SET tracked_media_type = 'show'
    WHERE tracked_media_type = 'anime';

    ALTER TABLE profile_tracked_series
      DROP CONSTRAINT IF EXISTS profile_tracked_series_media_type_check;

    ALTER TABLE profile_tracked_series
      ADD CONSTRAINT profile_tracked_series_media_type_check
      CHECK (tracked_media_type IN ('show'));

    ALTER TABLE profile_tracked_series
      DROP CONSTRAINT IF EXISTS profile_tracked_series_provider_check;

    ALTER TABLE profile_tracked_series
      ADD CONSTRAINT profile_tracked_series_provider_check
      CHECK (provider IN ('tmdb'));
  END IF;
END $$;

DROP TABLE IF EXISTS tvdb_title_bundles;
DROP TABLE IF EXISTS kitsu_title_bundles;
