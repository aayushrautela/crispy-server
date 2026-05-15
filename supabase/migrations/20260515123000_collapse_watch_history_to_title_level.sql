-- Collapse user-facing watch history to title-level rows while preserving raw episode ledger events.

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
  metadata_rating numeric(5,2)
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
    FROM public.watch_events we
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
    mc.rating
  FROM title_ranked ranked
  LEFT JOIN public.watch_media_card_cache mc ON mc.media_key = ranked.history_title_media_key
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

COMMENT ON FUNCTION public.list_watch_history_page(uuid, integer, timestamptz, uuid) IS 'Returns user-facing chronological watch history collapsed to one row per title-level movie or show.';
