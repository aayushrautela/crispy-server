-- Add extra metadata fields (overview, runtime, release_date, status, episode_title, episode_air_date)
-- to watch_media_card_cache and watch state RPC return types.

ALTER TABLE public.watch_media_card_cache
  ADD COLUMN IF NOT EXISTS overview text,
  ADD COLUMN IF NOT EXISTS runtime_minutes integer,
  ADD COLUMN IF NOT EXISTS release_date text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS episode_title text,
  ADD COLUMN IF NOT EXISTS episode_air_date text;

COMMENT ON COLUMN public.watch_media_card_cache.overview IS 'Short plot summary / tagline from TMDB.';
COMMENT ON COLUMN public.watch_media_card_cache.runtime_minutes IS 'Runtime in minutes: episode runtime for episodes, show/movie runtime otherwise.';
COMMENT ON COLUMN public.watch_media_card_cache.release_date IS 'Release or premiere date string (ISO-8601 date).';
COMMENT ON COLUMN public.watch_media_card_cache.status IS 'Release status (e.g. Released, In Production, Ended).';
COMMENT ON COLUMN public.watch_media_card_cache.episode_title IS 'Episode title for episode-level cache records.';
COMMENT ON COLUMN public.watch_media_card_cache.episode_air_date IS 'Episode air date for episode-level cache records.';

-- ====================================================================
-- 1. get_profile_watch_state — add new cache columns
-- ====================================================================

DROP FUNCTION IF EXISTS public.get_profile_watch_state(uuid, text[]);

CREATE OR REPLACE FUNCTION public.get_profile_watch_state(
  p_profile_id uuid,
  p_media_keys text[]
)
RETURNS TABLE(
  media_key text,
  effective_watched boolean,
  play_count integer,
  last_watched_at timestamptz,
  last_unwatched_at timestamptz,
  progress_bps smallint,
  position_seconds integer,
  duration_seconds integer,
  last_activity_at timestamptz,
  continue_title_media_key text,
  continue_position_seconds integer,
  continue_duration_seconds integer,
  continue_progress_bps smallint,
  continue_last_activity_at timestamptz,
  continue_dismissed_at timestamptz,
  watched_episode_keys text[],
  watchlist_added_at timestamptz,
  favorite_added_at timestamptz,
  rating smallint,
  rated_at timestamptz,
  title text,
  subtitle text,
  poster_url text,
  backdrop_url text,
  release_year integer,
  metadata_rating numeric(5,2),
  overview text,
  runtime_minutes integer,
  release_date text,
  status text,
  episode_title text,
  episode_air_date text,
  source_kind text,
  source_provider text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF NOT private.is_profile_member(p_profile_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT DISTINCT unnest(COALESCE(p_media_keys, ARRAY[]::text[])) AS media_key
  ),
  watched_episodes AS (
    SELECT s.title_media_key AS show_media_key,
           array_agg(s.media_key ORDER BY s.season_number NULLS LAST, s.episode_number NULLS LAST, s.media_key) AS episode_keys
    FROM requested req
    JOIN user_state.media_watch_summary s
      ON s.title_media_key = req.media_key
     AND s.media_type = 'episode'
     AND s.effective_watched = true
    WHERE s.profile_id = p_profile_id
    GROUP BY s.title_media_key
  )
  SELECT
    req.media_key,
    COALESCE(s.effective_watched, false),
    COALESCE(s.play_count, 0),
    s.last_watched_at,
    s.last_unwatched_at,
    dp.progress_bps,
    dp.position_seconds,
    dp.duration_seconds,
    dp.last_activity_at,
    cp.title_media_key,
    cp.position_seconds,
    cp.duration_seconds,
    cp.progress_bps,
    cp.last_activity_at,
    cp.dismissed_at,
    COALESCE(we.episode_keys, ARRAY[]::text[]),
    wl.added_at,
    fv.added_at,
    r.rating,
    r.rated_at,
    mc.title,
    mc.subtitle,
    mc.poster_url,
    mc.backdrop_url,
    mc.release_year,
    mc.rating,
    mc.overview,
    mc.runtime_minutes,
    mc.release_date,
    mc.status,
    mc.episode_title,
    mc.episode_air_date,
    COALESCE(s.source_kind, 'local'),
    s.source_provider
  FROM requested req
  LEFT JOIN user_state.media_watch_summary s
    ON s.profile_id = p_profile_id
   AND s.media_key = req.media_key
  LEFT JOIN user_state.playback_progress dp
    ON dp.profile_id = p_profile_id
   AND dp.playable_media_key = req.media_key
   AND dp.dismissed_at IS NULL
  LEFT JOIN user_state.playback_progress cp
    ON cp.profile_id = p_profile_id
   AND cp.title_media_key = req.media_key
   AND cp.dismissed_at IS NULL
  LEFT JOIN watched_episodes we ON we.show_media_key = req.media_key
  LEFT JOIN user_state.profile_list_items wl
    ON wl.profile_id = p_profile_id
   AND wl.media_key = req.media_key
   AND wl.list_kind = 'watchlist'
  LEFT JOIN user_state.profile_list_items fv
    ON fv.profile_id = p_profile_id
   AND fv.media_key = req.media_key
   AND fv.list_kind = 'favorites'
  LEFT JOIN user_state.profile_ratings r
    ON r.profile_id = p_profile_id
   AND r.media_key = req.media_key
  LEFT JOIN public.watch_media_card_cache mc
    ON mc.media_key = req.media_key
   AND mc.language = 'en';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_profile_watch_state(uuid, text[]) TO authenticated;

-- ====================================================================
-- 2. list_watch_history_page — add new cache columns
-- ====================================================================

DROP FUNCTION IF EXISTS public.list_watch_history_page(uuid, integer, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.list_watch_history_page(
  p_profile_id uuid,
  p_limit integer DEFAULT 50,
  p_cursor_occurred_at timestamptz DEFAULT NULL::timestamptz,
  p_cursor_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  id uuid,
  account_id uuid,
  profile_id uuid,
  media_key text,
  title_media_key text,
  media_type text,
  event_type text,
  occurred_at timestamptz,
  source_kind text,
  source_provider text,
  created_at timestamptz,
  title text,
  subtitle text,
  poster_url text,
  backdrop_url text,
  release_year integer,
  metadata_rating numeric(5,2),
  overview text,
  runtime_minutes integer,
  release_date text,
  status text,
  episode_title text,
  episode_air_date text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT private.is_profile_member(p_profile_id) THEN RAISE EXCEPTION 'access denied'; END IF;

  RETURN QUERY
  WITH title_ranked AS (
    SELECT
      we.id,
      we.account_id,
      we.profile_id,
      COALESCE(NULLIF(we.title_media_key, ''), public.canonical_title_media_key(we.media_key)) AS history_title_media_key,
      CASE
        WHEN we.media_type = 'movie' THEN 'movie'
        ELSE 'show'
      END AS history_title_media_type,
      we.event_type,
      we.occurred_at,
      we.source_kind,
      we.source_provider,
      we.created_at,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(NULLIF(we.title_media_key, ''), public.canonical_title_media_key(we.media_key))
        ORDER BY we.occurred_at DESC, we.id DESC
      ) AS rn
    FROM user_state.watch_events we
    WHERE we.profile_id = p_profile_id
      AND we.event_type IN ('playback_completed', 'marked_watched')
  )
  SELECT
    ranked.id,
    ranked.account_id,
    ranked.profile_id,
    ranked.history_title_media_key,
    ranked.history_title_media_key,
    ranked.history_title_media_type,
    ranked.event_type,
    ranked.occurred_at,
    ranked.source_kind,
    ranked.source_provider,
    ranked.created_at,
    mc.title,
    mc.subtitle,
    mc.poster_url,
    mc.backdrop_url,
    mc.release_year,
    mc.rating,
    mc.overview,
    mc.runtime_minutes,
    mc.release_date,
    mc.status,
    mc.episode_title,
    mc.episode_air_date
  FROM title_ranked ranked
  LEFT JOIN public.watch_media_card_cache mc
    ON mc.media_key = ranked.history_title_media_key
   AND mc.language = 'en'
  WHERE ranked.rn = 1
    AND (
      p_cursor_occurred_at IS NULL
      OR ranked.occurred_at < p_cursor_occurred_at
      OR (ranked.occurred_at = p_cursor_occurred_at AND ranked.id < p_cursor_id)
    )
  ORDER BY ranked.occurred_at DESC, ranked.id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100)) + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_watch_history_page(uuid, integer, timestamptz, uuid) TO authenticated;

-- ====================================================================
-- 3. list_media_watch_history_page — add new cache columns
-- ====================================================================

DROP FUNCTION IF EXISTS public.list_media_watch_history_page(uuid, text, integer, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.list_media_watch_history_page(
  p_profile_id uuid,
  p_media_key text,
  p_limit integer DEFAULT 50,
  p_cursor_occurred_at timestamptz DEFAULT NULL::timestamptz,
  p_cursor_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  id uuid,
  account_id uuid,
  profile_id uuid,
  media_key text,
  title_media_key text,
  media_type text,
  event_type text,
  occurred_at timestamptz,
  source_kind text,
  source_provider text,
  created_at timestamptz,
  title text,
  subtitle text,
  poster_url text,
  backdrop_url text,
  release_year integer,
  metadata_rating numeric(5,2),
  overview text,
  runtime_minutes integer,
  release_date text,
  status text,
  episode_title text,
  episode_air_date text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT private.is_profile_member(p_profile_id) THEN RAISE EXCEPTION 'access denied'; END IF;

  RETURN QUERY
  SELECT
    we.id,
    we.account_id,
    we.profile_id,
    we.media_key,
    we.title_media_key,
    we.media_type,
    we.event_type,
    we.occurred_at,
    we.source_kind,
    we.source_provider,
    we.created_at,
    mc.title,
    mc.subtitle,
    mc.poster_url,
    mc.backdrop_url,
    mc.release_year,
    mc.rating,
    mc.overview,
    mc.runtime_minutes,
    mc.release_date,
    mc.status,
    mc.episode_title,
    mc.episode_air_date
  FROM user_state.watch_events we
  LEFT JOIN public.watch_media_card_cache mc
    ON mc.media_key = we.media_key
   AND mc.language = 'en'
  WHERE we.profile_id = p_profile_id
    AND we.event_type IN ('playback_completed', 'marked_watched')
    AND (
      we.media_key = p_media_key
      OR we.title_media_key = p_media_key
    )
    AND (
      p_cursor_occurred_at IS NULL
      OR we.occurred_at < p_cursor_occurred_at
      OR (we.occurred_at = p_cursor_occurred_at AND we.id < p_cursor_id)
    )
  ORDER BY we.occurred_at DESC, we.id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100)) + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_media_watch_history_page(uuid, text, integer, timestamptz, uuid) TO authenticated;
