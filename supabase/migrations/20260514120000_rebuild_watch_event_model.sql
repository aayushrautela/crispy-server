-- Migration: Rebuild watch data model on event sourcing with fast read projection
--
-- Replaces the problematic profile_media_state+watch_history+continue_watching_items
-- pattern with:
--   watch_events            - append-only fact log (source of truth)
--   playback_progress       - active resumable sessions
--   media_watch_summary     - compact derived state per profile+media_key (fast reads)
--   watch_sessions          - optional rewatch grouping
--
-- This migration: creates new tables, backfills from old tables, replaces
-- RPC implementations, and grants permissions. Old tables are preserved but
-- orphaned so the deploy can be rolled back.

-- ====================================================================
-- 4. Replace RPC: get_profile_watch_state
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
  -- progress from direct playable match
  progress_bps smallint,
  position_seconds integer,
  duration_seconds integer,
  last_activity_at timestamptz,
  -- continue watching from title-level match
  continue_title_media_key text,
  continue_position_seconds integer,
  continue_duration_seconds integer,
  continue_progress_bps smallint,
  continue_last_activity_at timestamptz,
  continue_dismissed_at timestamptz,
  -- show-level episode keys
  watched_episode_keys text[],
  -- watchlist, favorites, ratings
  watchlist_added_at timestamptz,
  favorite_added_at timestamptz,
  rating smallint,
  rated_at timestamptz,
  -- metadata enrichment columns (same as before)
  title text,
  subtitle text,
  poster_url text,
  backdrop_url text,
  release_year integer,
  metadata_rating numeric(5,2),
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
  summary AS (
    SELECT s.*
    FROM public.media_watch_summary s
    JOIN requested req ON req.media_key = s.media_key
    WHERE s.profile_id = p_profile_id
  ),
  direct_progress AS (
    SELECT pp.*
    FROM public.playback_progress pp
    JOIN requested req ON req.media_key = pp.playable_media_key
    WHERE pp.profile_id = p_profile_id AND pp.dismissed_at IS NULL
  ),
  continue_progress AS (
    SELECT pp.*
    FROM public.playback_progress pp
    JOIN requested req ON req.media_key = pp.title_media_key
    WHERE pp.profile_id = p_profile_id AND pp.dismissed_at IS NULL
  ),
  watched_episodes AS (
    SELECT s.title_media_key AS show_media_key,
           array_agg(s.media_key ORDER BY s.media_key) AS episode_keys
    FROM requested req
    JOIN public.media_watch_summary s
      ON s.title_media_key = req.media_key
     AND s.media_type = 'episode'
     AND s.effective_watched = true
    WHERE s.profile_id = p_profile_id
    GROUP BY s.title_media_key
  ),
  watchlist AS (
    SELECT item.media_key, item.added_at
    FROM public.profile_list_items item
    JOIN requested req ON req.media_key = item.media_key
    WHERE item.profile_id = p_profile_id AND item.list_kind = 'watchlist'
  ),
  favorites AS (
    SELECT item.media_key, item.added_at
    FROM public.profile_list_items item
    JOIN requested req ON req.media_key = item.media_key
    WHERE item.profile_id = p_profile_id AND item.list_kind = 'favorites'
  ),
  ratings AS (
    SELECT r.media_key, r.rating, r.rated_at
    FROM public.profile_ratings r
    JOIN requested req ON req.media_key = r.media_key
    WHERE r.profile_id = p_profile_id
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
    cp.title_media_key AS continue_title_media_key,
    cp.position_seconds AS continue_position_seconds,
    cp.duration_seconds AS continue_duration_seconds,
    cp.progress_bps AS continue_progress_bps,
    cp.last_activity_at AS continue_last_activity_at,
    cp.dismissed_at AS continue_dismissed_at,
    COALESCE(we.episode_keys, ARRAY[]::text[]),
    wl.added_at AS watchlist_added_at,
    fv.added_at AS favorite_added_at,
    r.rating,
    r.rated_at,
    -- metadata enrichment from watch_media_card_cache
    mc.title,
    mc.subtitle,
    mc.poster_url,
    mc.backdrop_url,
    mc.release_year,
    mc.rating,
    COALESCE(s.source_kind, 'local'),
    s.source_provider
  FROM requested req
  LEFT JOIN summary s ON s.media_key = req.media_key
  LEFT JOIN direct_progress dp ON dp.playable_media_key = req.media_key
  LEFT JOIN continue_progress cp ON cp.title_media_key = req.media_key
  LEFT JOIN watched_episodes we ON we.show_media_key = req.media_key
  LEFT JOIN watchlist wl ON wl.media_key = req.media_key
  LEFT JOIN favorites fv ON fv.media_key = req.media_key
  LEFT JOIN ratings r ON r.media_key = req.media_key
  LEFT JOIN public.watch_media_card_cache mc ON mc.media_key = req.media_key;
END;
$$;

-- ====================================================================
-- 5. Replace RPC: record_playback_state
--     Writes events + updates summary/playback_progress
--     Completion threshold: 85% (8500 bps)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.record_playback_state(
  p_profile_id uuid,
  p_media_key text,
  p_title_media_key text,
  p_media_type text,
  p_position_seconds integer DEFAULT NULL::integer,
  p_duration_seconds integer DEFAULT NULL::integer,
  p_progress_bps smallint DEFAULT NULL::smallint,
  p_event_kind text DEFAULT 'playback_progress'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
DECLARE
  v_account_id uuid;
  v_progress_bps smallint;
  v_completed boolean;
  v_now timestamptz := now();
  v_event_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT private.can_write_profile_media(p_profile_id) THEN
    RAISE EXCEPTION 'profile write access denied' USING ERRCODE = '42501';
  END IF;

  IF p_media_type NOT IN ('movie', 'show', 'season', 'episode') THEN
    RAISE EXCEPTION 'unsupported media type' USING ERRCODE = '22023';
  END IF;

  v_account_id := private.profile_owner_account_id(p_profile_id);
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '02000';
  END IF;

  v_progress_bps := COALESCE(
    p_progress_bps,
    CASE
      WHEN COALESCE(p_duration_seconds, 0) > 0
        THEN GREATEST(0, LEAST(10000, ROUND((COALESCE(p_position_seconds, 0)::numeric / p_duration_seconds::numeric) * 10000)::int))::smallint
      ELSE 0::smallint
    END
  );

  v_completed := p_event_kind = 'playback_completed' OR v_progress_bps >= 8500;

  IF v_completed THEN
    v_event_type := 'playback_completed';

    INSERT INTO public.watch_events (
      account_id, profile_id, media_key, title_media_key, media_type,
      event_type, occurred_at, position_seconds, duration_seconds, progress_bps,
      source_kind, last_actor_account_id
    ) VALUES (
      v_account_id, p_profile_id, p_media_key, p_title_media_key, p_media_type,
      v_event_type, v_now, p_position_seconds, p_duration_seconds, v_progress_bps,
      'local', auth.uid()
    );

    PERFORM public.refresh_media_watch_summary(p_profile_id, p_media_key);

    DELETE FROM public.playback_progress
    WHERE profile_id = p_profile_id AND title_media_key = p_title_media_key;

  ELSE
    INSERT INTO public.playback_progress (
      profile_id, title_media_key, playable_media_key, media_type,
      position_seconds, duration_seconds, progress_bps, last_activity_at,
      source_kind, account_id, last_actor_account_id
    ) VALUES (
      p_profile_id, p_title_media_key, p_media_key, p_media_type,
      GREATEST(0, COALESCE(p_position_seconds, 0)),
      NULLIF(p_duration_seconds, 0),
      v_progress_bps, v_now,
      'local', v_account_id, auth.uid()
    )
    ON CONFLICT (profile_id, title_media_key) DO UPDATE SET
      playable_media_key = EXCLUDED.playable_media_key,
      media_type = EXCLUDED.media_type,
      position_seconds = EXCLUDED.position_seconds,
      duration_seconds = EXCLUDED.duration_seconds,
      progress_bps = EXCLUDED.progress_bps,
      last_activity_at = EXCLUDED.last_activity_at,
      dismissed_at = NULL,
      source_kind = 'local',
      source_provider = NULL,
      last_actor_account_id = auth.uid(),
      updated_at = v_now;
  END IF;
END;
$$;

-- ====================================================================
-- 6. Replace RPC: set_profile_watched_state
--     Appends marked_watched/marked_unwatched events + updates summary
--     Does NOT delete history
-- ====================================================================

CREATE OR REPLACE FUNCTION public.set_profile_watched_state(
  p_profile_id uuid,
  p_media_key text,
  p_title_media_key text,
  p_media_type text,
  p_watch_state text,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
DECLARE
  v_account_id uuid;
  v_occurred_at timestamptz;
  v_event_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF p_watch_state NOT IN ('watched', 'unwatched') THEN
    RAISE EXCEPTION 'watch_state must be watched or unwatched';
  END IF;

  IF p_media_type NOT IN ('movie', 'show', 'season', 'episode') THEN
    RAISE EXCEPTION 'invalid media_type';
  END IF;

  IF NOT private.can_write_profile_media(p_profile_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  v_account_id := private.profile_owner_account_id(p_profile_id);
  v_occurred_at := COALESCE(p_occurred_at, now());

  IF p_watch_state = 'watched' THEN
    v_event_type := 'marked_watched';
  ELSE
    v_event_type := 'marked_unwatched';
  END IF;

  INSERT INTO public.watch_events (
    account_id, profile_id, media_key, title_media_key, media_type,
    event_type, occurred_at, source_kind, last_actor_account_id
  ) VALUES (
    v_account_id, p_profile_id, p_media_key, p_title_media_key, p_media_type,
    v_event_type, v_occurred_at, 'local', auth.uid()
  );

  PERFORM public.refresh_media_watch_summary(p_profile_id, p_media_key);

  -- Clear continue watching for watched items
  IF p_watch_state = 'watched' THEN
    DELETE FROM public.playback_progress
    WHERE profile_id = p_profile_id AND title_media_key = p_title_media_key;
  END IF;
END;
$$;

-- ====================================================================
-- 7. Replace RPC: dismiss_continue_watching
-- ====================================================================

CREATE OR REPLACE FUNCTION public.dismiss_continue_watching(
  p_profile_id uuid,
  p_title_media_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT private.can_write_profile_media(p_profile_id) THEN
    RAISE EXCEPTION 'profile write access denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.playback_progress
  SET dismissed_at = v_now,
      last_actor_account_id = auth.uid(),
      updated_at = v_now
  WHERE profile_id = p_profile_id
    AND title_media_key = p_title_media_key;
END;
$$;

-- ====================================================================
-- 8. Replace RPC: list_continue_watching_page
-- ====================================================================

CREATE OR REPLACE FUNCTION public.list_continue_watching_page(
  p_profile_id uuid,
  p_limit integer DEFAULT 20,
  p_cursor_last_activity_at timestamptz DEFAULT NULL::timestamptz,
  p_cursor_title_media_key text DEFAULT NULL::text
)
RETURNS TABLE(
  account_id uuid,
  profile_id uuid,
  title_media_key text,
  playable_media_key text,
  media_type text,
  position_seconds integer,
  duration_seconds integer,
  progress_bps smallint,
  last_activity_at timestamptz,
  dismissed_at timestamptz,
  source_kind text,
  source_provider text,
  created_at timestamptz,
  updated_at timestamptz
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
    pp.account_id,
    pp.profile_id,
    public.canonical_title_media_key(pp.title_media_key),
    pp.playable_media_key,
    public.canonical_title_media_type(pp.title_media_key, pp.media_type),
    pp.position_seconds,
    pp.duration_seconds,
    pp.progress_bps,
    pp.last_activity_at,
    pp.dismissed_at,
    pp.source_kind,
    pp.source_provider,
    pp.created_at,
    pp.updated_at
  FROM public.playback_progress pp
  WHERE pp.profile_id = p_profile_id
    AND pp.dismissed_at IS NULL
    AND pp.last_activity_at IS NOT NULL
    AND (
      p_cursor_last_activity_at IS NULL
      OR pp.last_activity_at < p_cursor_last_activity_at
      OR (pp.last_activity_at = p_cursor_last_activity_at AND pp.title_media_key < p_cursor_title_media_key)
    )
  ORDER BY pp.last_activity_at DESC, pp.title_media_key DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100)) + 1;
END;
$$;

-- ====================================================================
-- 9. Replace RPC: list_watch_history_page
--     Now reads from watch_events (only playback_completed)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.list_watch_history_page(
  p_profile_id uuid,
  p_limit integer DEFAULT 50,
  p_cursor_watched_at timestamptz DEFAULT NULL::timestamptz,
  p_cursor_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  id uuid,
  account_id uuid,
  profile_id uuid,
  media_key text,
  media_type text,
  watched_at timestamptz,
  source_kind text,
  created_at timestamptz
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
  WITH ranked AS (
    SELECT
      we.id,
      we.account_id,
      we.profile_id,
      public.canonical_title_media_key(we.media_key) AS title_media_key,
      public.canonical_title_media_type(we.media_key, we.media_type) AS title_media_type,
      we.occurred_at AS watched_at,
      we.source_kind,
      we.created_at,
      ROW_NUMBER() OVER (
        PARTITION BY public.canonical_title_media_key(we.media_key)
        ORDER BY we.occurred_at DESC, we.id DESC
      ) AS rn
    FROM public.watch_events we
    WHERE we.profile_id = p_profile_id
      AND we.event_type = 'playback_completed'
  )
  SELECT ranked.id, ranked.account_id, ranked.profile_id,
         ranked.title_media_key, ranked.title_media_type,
         ranked.watched_at, ranked.source_kind, ranked.created_at
  FROM ranked
  WHERE ranked.rn = 1
    AND (
      p_cursor_watched_at IS NULL
      OR ranked.watched_at < p_cursor_watched_at
      OR (ranked.watched_at = p_cursor_watched_at AND ranked.id < p_cursor_id)
    )
  ORDER BY ranked.watched_at DESC, ranked.id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100)) + 1;
END;
$$;

-- ====================================================================
-- 10. Replace RPC: replace_provider_import_history
--      Now writes to watch_events + rebuilds summary
-- ====================================================================

CREATE OR REPLACE FUNCTION public.replace_provider_import_history(
  target_account_id uuid,
  target_legacy_app_user_id text,
  target_account_email text,
  target_profile_id uuid,
  target_legacy_profile_group_id uuid,
  target_profile_name text,
  target_avatar_key text,
  target_is_kids boolean,
  target_sort_order integer,
  target_provider text,
  target_provider_user_id text,
  target_provider_username text,
  target_import_job_id uuid,
  target_history_generation integer,
  target_imported_at timestamptz,
  entries jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
DECLARE
  inserted_count integer;
  batch_id uuid;
BEGIN
  IF entries IS NULL OR jsonb_typeof(entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a JSON array';
  END IF;

  -- Upsert account/profile (same as before)
  INSERT INTO public.accounts (id, legacy_app_user_id, email, last_seen_at)
  VALUES (target_account_id, target_legacy_app_user_id, target_account_email, now())
  ON CONFLICT (id) DO UPDATE SET
    legacy_app_user_id = COALESCE(public.accounts.legacy_app_user_id, excluded.legacy_app_user_id),
    email = excluded.email,
    last_seen_at = now();

  INSERT INTO public.account_preferences (account_id, settings_json)
  VALUES (target_account_id, '{}'::jsonb)
  ON CONFLICT (account_id) DO NOTHING;

  INSERT INTO public.account_entitlements (account_id, tier, status, features)
  VALUES (target_account_id, 'free', 'active', '{}'::jsonb)
  ON CONFLICT (account_id) DO NOTHING;

  INSERT INTO public.profiles (
    id, account_id, legacy_profile_group_id, name, avatar_key, is_kids, sort_order, is_default, created_by_account_id
  ) VALUES (
    target_profile_id, target_account_id, target_legacy_profile_group_id,
    COALESCE(NULLIF(BTRIM(target_profile_name), ''), 'Main'),
    target_avatar_key, COALESCE(target_is_kids, false), COALESCE(target_sort_order, 0),
    false, target_account_id
  )
  ON CONFLICT (id) DO UPDATE SET
    account_id = excluded.account_id,
    legacy_profile_group_id = excluded.legacy_profile_group_id,
    name = excluded.name,
    avatar_key = excluded.avatar_key,
    is_kids = excluded.is_kids,
    sort_order = excluded.sort_order,
    deleted_at = NULL;

  INSERT INTO public.profile_members (profile_id, account_id, role)
  VALUES (target_profile_id, target_account_id, 'owner')
  ON CONFLICT (profile_id, account_id) DO UPDATE SET role = 'owner';

  INSERT INTO public.profile_preferences (profile_id, settings_json)
  VALUES (target_profile_id, '{}'::jsonb)
  ON CONFLICT (profile_id) DO NOTHING;

  -- Delete old provider import events
  DELETE FROM public.watch_events we
  USING public.provider_import_batches b
  WHERE we.import_batch_id = b.id
    AND we.profile_id = target_profile_id
    AND we.source_kind = 'provider_import'
    AND b.source_provider = target_provider;

  DELETE FROM public.provider_import_batches
  WHERE profile_id = target_profile_id
    AND source_provider = target_provider;

  -- Create new batch
  INSERT INTO public.provider_import_batches (
    account_id, profile_id, source_provider, provider_user_id, provider_username,
    provider_import_job_id, provider_history_generation, imported_at, row_count
  ) VALUES (
    target_account_id, target_profile_id, target_provider,
    NULLIF(BTRIM(COALESCE(target_provider_user_id, '')), ''),
    NULLIF(BTRIM(COALESCE(target_provider_username, '')), ''),
    target_import_job_id, target_history_generation, target_imported_at,
    jsonb_array_length(entries)
  )
  RETURNING id INTO batch_id;

  -- Insert into watch_events
  INSERT INTO public.watch_events (
    account_id, profile_id, import_batch_id, media_key, title_media_key, media_type,
    event_type, occurred_at, source_kind
  )
  SELECT
    target_account_id,
    target_profile_id,
    batch_id,
    entry.media_key,
    public.canonical_title_media_key(entry.media_key),
    entry.media_type,
    'provider_import',
    entry.watched_at,
    entry.source_kind
  FROM jsonb_to_recordset(entries) AS entry(
    media_key text,
    media_type text,
    watched_at timestamptz,
    source_kind text
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  UPDATE public.provider_import_batches
  SET row_count = inserted_count
  WHERE id = batch_id;

  -- Rebuild summary for imported media keys
  WITH imported_keys AS (
    SELECT DISTINCT entry.media_key::text AS media_key
    FROM jsonb_to_recordset(entries) AS entry(media_key text, media_type text, watched_at timestamptz, source_kind text)
  )
  SELECT public.refresh_media_watch_summary(target_profile_id, ik.media_key)
  FROM imported_keys ik;

  RETURN inserted_count;
END;
$$;

-- ====================================================================
-- 11. Replace RPC: replace_provider_import_playback_states
--      Now writes to playback_progress + watch_events + summary
-- ====================================================================

CREATE OR REPLACE FUNCTION public.replace_provider_import_playback_states(
  p_account_id uuid,
  p_profile_id uuid,
  p_provider text,
  p_states jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
DECLARE
  v_state jsonb;
  v_inserted_count integer := 0;
  v_duration_seconds integer;
  v_completed boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id AND account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Profile does not belong to account';
  END IF;

  DELETE FROM public.playback_progress
  WHERE profile_id = p_profile_id
    AND source_kind = 'provider_import'
    AND source_provider = p_provider;

  FOR v_state IN SELECT * FROM jsonb_array_elements(p_states)
  LOOP
    v_duration_seconds := NULLIF((v_state->>'duration_seconds')::integer, 0);
    v_completed := (v_state->>'completed')::boolean;

    IF v_completed THEN
      INSERT INTO public.watch_events (
        account_id, profile_id, media_key, title_media_key, media_type,
        event_type, occurred_at, position_seconds, duration_seconds, progress_bps,
        source_kind, source_provider, last_actor_account_id
      ) VALUES (
        p_account_id, p_profile_id,
        v_state->>'media_key',
        v_state->>'title_media_key',
        v_state->>'media_type',
        'provider_import',
        (v_state->>'occurred_at')::timestamptz,
        (v_state->>'position_seconds')::integer,
        v_duration_seconds,
        (v_state->>'progress_bps')::integer,
        'provider_import', p_provider, p_account_id
      );

      PERFORM public.refresh_media_watch_summary(p_profile_id, v_state->>'media_key');
    ELSE
      INSERT INTO public.playback_progress (
        profile_id, title_media_key, playable_media_key, media_type,
        position_seconds, duration_seconds, progress_bps, last_activity_at,
        source_kind, source_provider, account_id, last_actor_account_id
      ) VALUES (
        p_profile_id,
        v_state->>'title_media_key',
        v_state->>'media_key',
        v_state->>'media_type',
        (v_state->>'position_seconds')::integer,
        v_duration_seconds,
        (v_state->>'progress_bps')::integer,
        (v_state->>'occurred_at')::timestamptz,
        'provider_import', p_provider, p_account_id, p_account_id
      )
      ON CONFLICT (profile_id, title_media_key) DO UPDATE SET
        playable_media_key = EXCLUDED.playable_media_key,
        media_type = EXCLUDED.media_type,
        position_seconds = EXCLUDED.position_seconds,
        duration_seconds = EXCLUDED.duration_seconds,
        progress_bps = EXCLUDED.progress_bps,
        last_activity_at = EXCLUDED.last_activity_at,
        dismissed_at = NULL,
        source_kind = 'provider_import',
        source_provider = p_provider,
        last_actor_account_id = p_account_id,
        updated_at = now();
    END IF;

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  RETURN v_inserted_count;
END;
$$;

-- ====================================================================
-- 12. RLS policies for new tables
-- ====================================================================

ALTER TABLE public.watch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playback_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_watch_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_sessions ENABLE ROW LEVEL SECURITY;

-- watch_events: service role full access, members select only
CREATE POLICY watch_events_select_member ON public.watch_events
  FOR SELECT TO authenticated
  USING (account_id = auth.uid() AND private.is_profile_member(profile_id));

CREATE POLICY watch_events_insert_member ON public.watch_events
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = auth.uid()
    AND private.can_write_profile_media(profile_id)
    AND source_kind = 'local'
    AND source_provider IS NULL
  );

CREATE POLICY watch_events_delete_member ON public.watch_events
  FOR DELETE TO authenticated
  USING (
    account_id = auth.uid()
    AND private.can_write_profile_media(profile_id)
    AND source_kind = 'local'
    AND source_provider IS NULL
  );

CREATE POLICY watch_events_service_all ON public.watch_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- playback_progress
CREATE POLICY playback_progress_select_member ON public.playback_progress
  FOR SELECT TO authenticated
  USING (account_id = auth.uid() AND private.is_profile_member(profile_id));

CREATE POLICY playback_progress_insert_member ON public.playback_progress
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = auth.uid()
    AND private.can_write_profile_media(profile_id)
    AND source_kind = 'local'
    AND source_provider IS NULL
  );

CREATE POLICY playback_progress_update_member ON public.playback_progress
  FOR UPDATE TO authenticated
  USING (account_id = auth.uid() AND private.can_write_profile_media(profile_id))
  WITH CHECK (
    account_id = auth.uid()
    AND private.can_write_profile_media(profile_id)
    AND source_kind = 'local'
    AND source_provider IS NULL
  );

CREATE POLICY playback_progress_delete_member ON public.playback_progress
  FOR DELETE TO authenticated
  USING (account_id = auth.uid() AND private.can_write_profile_media(profile_id));

CREATE POLICY playback_progress_service_all ON public.playback_progress
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- media_watch_summary
CREATE POLICY media_watch_summary_select_member ON public.media_watch_summary
  FOR SELECT TO authenticated
  USING (account_id = auth.uid() AND private.is_profile_member(profile_id));

CREATE POLICY media_watch_summary_service_all ON public.media_watch_summary
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- watch_sessions
CREATE POLICY watch_sessions_select_member ON public.watch_sessions
  FOR SELECT TO authenticated
  USING (account_id = auth.uid() AND private.is_profile_member(profile_id));

CREATE POLICY watch_sessions_insert_member ON public.watch_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = auth.uid()
    AND private.can_write_profile_media(profile_id)
  );

CREATE POLICY watch_sessions_update_member ON public.watch_sessions
  FOR UPDATE TO authenticated
  USING (account_id = auth.uid() AND private.can_write_profile_media(profile_id));

CREATE POLICY watch_sessions_delete_member ON public.watch_sessions
  FOR DELETE TO authenticated
  USING (account_id = auth.uid() AND private.can_write_profile_media(profile_id));

CREATE POLICY watch_sessions_service_all ON public.watch_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ====================================================================
-- 13. Grant function execution
-- ====================================================================

GRANT EXECUTE ON FUNCTION public.get_profile_watch_state TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_playback_state TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_watched_state TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_continue_watching TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_continue_watching_page TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_watch_history_page TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_media_watch_summary TO service_role;

-- ====================================================================
-- 14. Backfill data from old tables (idempotent)
-- ====================================================================

-- 14a. Backfill watch_events from watch_history
INSERT INTO public.watch_events (
  account_id, profile_id, media_key, title_media_key, media_type,
  event_type, occurred_at, source_kind, import_batch_id, created_at
)
SELECT
  wh.account_id,
  wh.profile_id,
  wh.media_key,
  public.canonical_title_media_key(wh.media_key),
  wh.media_type,
  'playback_completed',
  wh.watched_at,
  wh.source_kind,
  wh.import_batch_id,
  wh.created_at
FROM public.watch_history wh
WHERE NOT EXISTS (
  SELECT 1 FROM public.watch_events we
  WHERE we.profile_id = wh.profile_id
    AND we.media_key = wh.media_key
    AND we.event_type = 'playback_completed'
    AND we.occurred_at = wh.watched_at
);

-- 14b. Backfill playback_progress from continue_watching_items
INSERT INTO public.playback_progress (
  profile_id, title_media_key, playable_media_key, media_type,
  position_seconds, duration_seconds, progress_bps, last_activity_at,
  dismissed_at, source_kind, source_provider, account_id, last_actor_account_id,
  created_at, updated_at
)
SELECT
  cwi.profile_id,
  cwi.title_media_key,
  cwi.playable_media_key,
  cwi.media_type,
  cwi.position_seconds,
  cwi.duration_seconds,
  cwi.progress_bps,
  cwi.last_activity_at,
  cwi.dismissed_at,
  cwi.source_kind,
  cwi.source_provider,
  cwi.account_id,
  cwi.last_actor_account_id,
  cwi.created_at,
  cwi.updated_at
FROM public.continue_watching_items cwi
ON CONFLICT (profile_id, title_media_key) DO NOTHING;

-- 14c. Backfill playback_progress from profile_media_state in-progress items
--      that aren't already in playback_progress
INSERT INTO public.playback_progress (
  profile_id, title_media_key, playable_media_key, media_type,
  position_seconds, duration_seconds, progress_bps, last_activity_at,
  dismissed_at, source_kind, source_provider, account_id, last_actor_account_id,
  created_at, updated_at
)
SELECT
  pms.profile_id,
  pms.title_media_key,
  pms.media_key,
  pms.media_type,
  pms.position_seconds,
  pms.duration_seconds,
  pms.progress_bps,
  COALESCE(pms.last_activity_at, now()),
  pms.continue_dismissed_at,
  pms.source_kind,
  pms.source_provider,
  pms.account_id,
  pms.last_actor_account_id,
  pms.created_at,
  pms.updated_at
FROM public.profile_media_state pms
WHERE pms.playback_status = 'in_progress'
  AND pms.progress_bps IS NOT NULL
  AND pms.progress_bps < 8500
  AND NOT EXISTS (
    SELECT 1 FROM public.playback_progress pp
    WHERE pp.profile_id = pms.profile_id AND pp.title_media_key = pms.title_media_key
  );

-- 14d. Backfill media_watch_summary from watch_events
INSERT INTO public.media_watch_summary (
  profile_id, media_key, title_media_key, media_type,
  season_number, episode_number,
  effective_watched, play_count, last_watched_at, last_unwatched_at, last_activity_at,
  source_kind, source_provider, account_id, updated_at
)
SELECT
  we.profile_id,
  we.media_key,
  public.canonical_title_media_key(we.media_key),
  we.media_type,
  CASE
    WHEN we.media_type = 'episode' THEN SPLIT_PART(we.media_key, ':', 4)::integer
    ELSE NULL
  END,
  CASE
    WHEN we.media_type = 'episode' THEN SPLIT_PART(we.media_key, ':', 5)::integer
    ELSE NULL
  END,
  COALESCE((
    SELECT we2.event_type IN ('playback_completed', 'marked_watched')
    FROM public.watch_events we2
    WHERE we2.profile_id = we.profile_id
      AND we2.media_key = we.media_key
      AND we2.event_type IN ('playback_completed', 'marked_watched', 'marked_unwatched')
    ORDER BY we2.occurred_at DESC, we2.id DESC
    LIMIT 1
  ), false),
  COUNT(*) FILTER (WHERE we.event_type = 'playback_completed')::integer,
  MAX(we.occurred_at) FILTER (WHERE we.event_type IN ('playback_completed', 'marked_watched')),
  MAX(we.occurred_at) FILTER (WHERE we.event_type = 'marked_unwatched'),
  MAX(we.occurred_at),
  COALESCE((
    SELECT we3.source_kind
    FROM public.watch_events we3
    WHERE we3.profile_id = we.profile_id AND we3.media_key = we.media_key
    ORDER BY we3.occurred_at DESC, we3.id DESC
    LIMIT 1
  ), 'local'),
  (SELECT we4.source_provider FROM public.watch_events we4 WHERE we4.profile_id = we.profile_id AND we4.media_key = we.media_key ORDER BY we4.occurred_at DESC, we4.id DESC LIMIT 1),
  we.account_id,
  now()
FROM public.watch_events we
GROUP BY we.profile_id, we.media_key, we.media_type, we.account_id
ON CONFLICT (profile_id, media_key) DO NOTHING;

-- ====================================================================
-- 15. Comments
-- ====================================================================

COMMENT ON TABLE public.watch_events IS 'Append-only log of watch-related events. Source of truth for watched state.';
COMMENT ON TABLE public.playback_progress IS 'Active resumable playback sessions. Replaces continue_watching_items.';
COMMENT ON TABLE public.media_watch_summary IS 'Compact derived watch state per profile+media_key. Fast read projection. Rebuildable from watch_events.';
COMMENT ON TABLE public.watch_sessions IS 'Optional rewatch session grouping. Used for explicit rewatch tracking.';
COMMENT ON FUNCTION public.refresh_media_watch_summary IS 'Rebuild media_watch_summary for a single profile+media_key from watch_events.';
