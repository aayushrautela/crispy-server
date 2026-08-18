-- Backfill watch_state from the legacy watch model.
-- Source of truth becomes watch_state; legacy tables are dropped in 0049.

-- 1. Resume state from playback_progress (currently in-progress items).
INSERT INTO user_state.watch_state
  (profile_id, account_id, item_id, title_item_id, media_type,
   season_number, episode_number, played, play_count,
   last_played_at, position_seconds, duration_seconds, progress_bps, updated_at)
SELECT
  pp.profile_id, pp.account_id, pp.playable_item_id, pp.title_item_id, pp.media_type,
  pp.season_number, pp.episode_number,
  false, 0,
  pp.last_activity_at,
  COALESCE(pp.position_seconds, 0), pp.duration_seconds, pp.progress_bps,
  now()
FROM user_state.playback_progress pp
ON CONFLICT (profile_id, item_id) DO NOTHING;

-- 2. Watched state from watch_events (history + play count + completion).
WITH agg AS (
  SELECT
    we.profile_id,
    we.item_id,
    we.title_item_id,
    we.media_type,
    (array_agg(we.event_type ORDER BY we.occurred_at DESC, we.id DESC))[1]
      = ANY (ARRAY['playback_completed', 'marked_watched']) AS is_watched,
    count(*) FILTER (WHERE we.event_type = ANY (ARRAY['playback_completed', 'marked_watched']))
      AS watched_count,
    max(we.occurred_at) FILTER (WHERE we.event_type = ANY (ARRAY['playback_completed', 'marked_watched']))
      AS latest_watched_at,
    max(we.season_number) AS season_number,
    max(we.episode_number) AS episode_number,
    (array_agg(we.account_id ORDER BY we.occurred_at DESC, we.id DESC))[1] AS account_id
  FROM user_state.watch_events we
  GROUP BY we.profile_id, we.item_id, we.title_item_id, we.media_type
)
INSERT INTO user_state.watch_state
  (profile_id, account_id, item_id, title_item_id, media_type,
   season_number, episode_number, played, play_count,
   last_played_at, position_seconds, duration_seconds, progress_bps, updated_at)
SELECT
  agg.profile_id, agg.account_id, agg.item_id, agg.title_item_id, agg.media_type,
  agg.season_number, agg.episode_number,
  agg.is_watched, agg.watched_count,
  agg.latest_watched_at,
  0, NULL, NULL,
  now()
FROM agg
ON CONFLICT (profile_id, item_id) DO UPDATE SET
  played = EXCLUDED.played,
  play_count = watch_state.play_count + EXCLUDED.play_count,
  last_played_at = GREATEST(watch_state.last_played_at, EXCLUDED.last_played_at),
  season_number = COALESCE(watch_state.season_number, EXCLUDED.season_number),
  episode_number = COALESCE(watch_state.episode_number, EXCLUDED.episode_number),
  title_item_id = COALESCE(watch_state.title_item_id, EXCLUDED.title_item_id),
  media_type = EXCLUDED.media_type,
  updated_at = now();

-- 3. Ratings from profile_ratings (item is its own title).
INSERT INTO user_state.watch_state
  (profile_id, account_id, item_id, title_item_id, media_type, rating, updated_at)
SELECT
  pr.profile_id, pr.account_id, pr.item_id, pr.item_id, pr.media_type, pr.rating, now()
FROM user_state.profile_ratings pr
ON CONFLICT (profile_id, item_id) DO UPDATE SET
  rating = EXCLUDED.rating,
  updated_at = now();

-- 4. Watchlist becomes the Jellyfin-style favorite flag.
INSERT INTO user_state.watch_state
  (profile_id, account_id, item_id, title_item_id, media_type, is_favorite, updated_at)
SELECT
  pli.profile_id, pli.account_id, pli.item_id, pli.item_id, pli.media_type, true, now()
FROM user_state.profile_list_items pli
ON CONFLICT (profile_id, item_id) DO UPDATE SET
  is_favorite = true,
  updated_at = now();
