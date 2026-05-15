-- Finalize watch domain cleanup: watch_events history, playback_progress resume, media_watch_summary state

UPDATE public.watch_events
SET event_type = 'playback_completed',
    source_kind = 'provider_import'
WHERE event_type = 'provider_import';

ALTER TABLE public.watch_events DROP CONSTRAINT IF EXISTS watch_events_event_type_check;
ALTER TABLE public.watch_events ADD CONSTRAINT watch_events_event_type_check
  CHECK (event_type = ANY (ARRAY['playback_completed'::text, 'marked_watched'::text, 'marked_unwatched'::text]));

CREATE OR REPLACE FUNCTION public.refresh_media_watch_summary(
  p_profile_id uuid,
  p_media_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
DECLARE
  v_latest_state_event record;
BEGIN
  SELECT event_type, occurred_at, source_kind, source_provider
  INTO v_latest_state_event
  FROM public.watch_events
  WHERE profile_id = p_profile_id
    AND media_key = p_media_key
    AND event_type IN ('playback_completed', 'marked_watched', 'marked_unwatched')
  ORDER BY occurred_at DESC, created_at DESC, id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    DELETE FROM public.media_watch_summary
    WHERE profile_id = p_profile_id
      AND media_key = p_media_key;
    RETURN;
  END IF;

  INSERT INTO public.media_watch_summary (
    profile_id,
    media_key,
    title_media_key,
    media_type,
    season_number,
    episode_number,
    effective_watched,
    play_count,
    last_watched_at,
    last_unwatched_at,
    last_activity_at,
    source_kind,
    source_provider,
    account_id,
    updated_at
  )
  SELECT
    p_profile_id,
    we.media_key,
    COALESCE(NULLIF(MAX(we.title_media_key), ''), public.canonical_title_media_key(we.media_key)),
    MAX(we.media_type),
    CASE
      WHEN MAX(we.media_type) = 'episode' AND split_part(we.media_key, ':', 4) ~ '^[0-9]+$'
        THEN split_part(we.media_key, ':', 4)::integer
      ELSE NULL
    END,
    CASE
      WHEN MAX(we.media_type) = 'episode' AND split_part(we.media_key, ':', 5) ~ '^[0-9]+$'
        THEN split_part(we.media_key, ':', 5)::integer
      ELSE NULL
    END,
    v_latest_state_event.event_type IN ('playback_completed', 'marked_watched'),
    COUNT(*) FILTER (WHERE we.event_type = 'playback_completed')::integer,
    MAX(we.occurred_at) FILTER (WHERE we.event_type IN ('playback_completed', 'marked_watched')),
    MAX(we.occurred_at) FILTER (WHERE we.event_type = 'marked_unwatched'),
    MAX(we.occurred_at),
    COALESCE(v_latest_state_event.source_kind, 'local'),
    v_latest_state_event.source_provider,
    MAX(we.account_id),
    now()
  FROM public.watch_events we
  WHERE we.profile_id = p_profile_id
    AND we.media_key = p_media_key
    AND we.event_type IN ('playback_completed', 'marked_watched', 'marked_unwatched')
  GROUP BY we.media_key
  ON CONFLICT (profile_id, media_key) DO UPDATE SET
    title_media_key = EXCLUDED.title_media_key,
    media_type = EXCLUDED.media_type,
    season_number = EXCLUDED.season_number,
    episode_number = EXCLUDED.episode_number,
    effective_watched = EXCLUDED.effective_watched,
    play_count = EXCLUDED.play_count,
    last_watched_at = EXCLUDED.last_watched_at,
    last_unwatched_at = EXCLUDED.last_unwatched_at,
    last_activity_at = EXCLUDED.last_activity_at,
    source_kind = EXCLUDED.source_kind,
    source_provider = EXCLUDED.source_provider,
    account_id = EXCLUDED.account_id,
    updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_media_watch_summary(p_profile_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  IF p_profile_id IS NULL THEN
    DELETE FROM public.media_watch_summary;
  ELSE
    DELETE FROM public.media_watch_summary WHERE profile_id = p_profile_id;
  END IF;

  FOR v_row IN
    SELECT DISTINCT profile_id, media_key
    FROM public.watch_events
    WHERE event_type IN ('playback_completed', 'marked_watched', 'marked_unwatched')
      AND (p_profile_id IS NULL OR profile_id = p_profile_id)
  LOOP
    PERFORM public.refresh_media_watch_summary(v_row.profile_id, v_row.media_key);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

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
    JOIN public.media_watch_summary s
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
    COALESCE(s.source_kind, 'local'),
    s.source_provider
  FROM requested req
  LEFT JOIN public.media_watch_summary s
    ON s.profile_id = p_profile_id
   AND s.media_key = req.media_key
  LEFT JOIN public.playback_progress dp
    ON dp.profile_id = p_profile_id
   AND dp.playable_media_key = req.media_key
   AND dp.dismissed_at IS NULL
  LEFT JOIN public.playback_progress cp
    ON cp.profile_id = p_profile_id
   AND cp.title_media_key = req.media_key
   AND cp.dismissed_at IS NULL
  LEFT JOIN watched_episodes we ON we.show_media_key = req.media_key
  LEFT JOIN public.profile_list_items wl
    ON wl.profile_id = p_profile_id
   AND wl.media_key = req.media_key
   AND wl.list_kind = 'watchlist'
  LEFT JOIN public.profile_list_items fv
    ON fv.profile_id = p_profile_id
   AND fv.media_key = req.media_key
   AND fv.list_kind = 'favorites'
  LEFT JOIN public.profile_ratings r
    ON r.profile_id = p_profile_id
   AND r.media_key = req.media_key
  LEFT JOIN public.watch_media_card_cache mc ON mc.media_key = req.media_key;
END;
$$;

DROP FUNCTION IF EXISTS public.record_playback_state(uuid, text, text, text, integer, integer, smallint, text);

CREATE OR REPLACE FUNCTION public.record_playback_state(
  p_profile_id uuid,
  p_media_key text,
  p_title_media_key text,
  p_media_type text,
  p_position_seconds integer DEFAULT NULL::integer,
  p_duration_seconds integer DEFAULT NULL::integer,
  p_progress_bps smallint DEFAULT NULL::smallint,
  p_event_kind text DEFAULT 'playback_progress'::text,
  p_occurred_at timestamptz DEFAULT NULL::timestamptz,
  p_client_event_id text DEFAULT NULL::text
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
  v_occurred_at timestamptz := COALESCE(p_occurred_at, now());
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
    INSERT INTO public.watch_events (
      account_id, profile_id, media_key, title_media_key, media_type,
      event_type, occurred_at, position_seconds, duration_seconds, progress_bps,
      source_kind, client_event_id, last_actor_account_id
    ) VALUES (
      v_account_id, p_profile_id, p_media_key, p_title_media_key, p_media_type,
      'playback_completed', v_occurred_at, p_position_seconds, p_duration_seconds, v_progress_bps,
      'local', NULLIF(BTRIM(COALESCE(p_client_event_id, '')), ''), auth.uid()
    )
    ON CONFLICT DO NOTHING;

    DELETE FROM public.playback_progress
    WHERE profile_id = p_profile_id
      AND title_media_key = p_title_media_key;

    PERFORM public.refresh_media_watch_summary(p_profile_id, p_media_key);
  ELSE
    INSERT INTO public.playback_progress (
      profile_id, title_media_key, playable_media_key, media_type,
      position_seconds, duration_seconds, progress_bps, last_activity_at,
      source_kind, account_id, last_actor_account_id
    ) VALUES (
      p_profile_id, p_title_media_key, p_media_key, p_media_type,
      GREATEST(0, COALESCE(p_position_seconds, 0)),
      NULLIF(p_duration_seconds, 0),
      v_progress_bps,
      v_occurred_at,
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
      updated_at = now();
  END IF;
END;
$$;

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
  v_event_type := CASE WHEN p_watch_state = 'watched' THEN 'marked_watched' ELSE 'marked_unwatched' END;

  INSERT INTO public.watch_events (
    account_id, profile_id, media_key, title_media_key, media_type,
    event_type, occurred_at, source_kind, last_actor_account_id
  ) VALUES (
    v_account_id, p_profile_id, p_media_key, p_title_media_key, p_media_type,
    v_event_type, COALESCE(p_occurred_at, now()), 'local', auth.uid()
  );

  IF p_watch_state = 'watched' THEN
    DELETE FROM public.playback_progress
    WHERE profile_id = p_profile_id
      AND title_media_key = p_title_media_key;
  END IF;

  PERFORM public.refresh_media_watch_summary(p_profile_id, p_media_key);
END;
$$;

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
    mc.rating
  FROM public.watch_events we
  LEFT JOIN public.watch_media_card_cache mc ON mc.media_key = we.media_key
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

DROP FUNCTION IF EXISTS public.replace_provider_import_history(uuid, uuid, text, uuid, uuid, text, text, boolean, integer, text, text, text, uuid, integer, timestamptz, jsonb);

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
  inserted_count integer := 0;
  batch_id uuid;
  v_old_keys text[];
  v_key text;
BEGIN
  IF entries IS NULL OR jsonb_typeof(entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a JSON array';
  END IF;

  INSERT INTO public.accounts (id, legacy_app_user_id, email, last_seen_at)
  VALUES (
    target_account_id,
    CASE WHEN target_legacy_app_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_legacy_app_user_id::uuid ELSE NULL END,
    target_account_email,
    now()
  )
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

  SELECT COALESCE(array_agg(DISTINCT we.media_key), ARRAY[]::text[])
  INTO v_old_keys
  FROM public.watch_events we
  JOIN public.provider_import_batches b ON b.id = we.import_batch_id
  WHERE we.profile_id = target_profile_id
    AND we.source_kind = 'provider_import'
    AND b.source_provider = target_provider;

  DELETE FROM public.watch_events we
  USING public.provider_import_batches b
  WHERE we.import_batch_id = b.id
    AND we.profile_id = target_profile_id
    AND we.source_kind = 'provider_import'
    AND b.source_provider = target_provider;

  DELETE FROM public.provider_import_batches
  WHERE profile_id = target_profile_id
    AND source_provider = target_provider;

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

  INSERT INTO public.watch_events (
    account_id, profile_id, import_batch_id, media_key, title_media_key, media_type,
    event_type, occurred_at, source_kind, source_provider, last_actor_account_id
  )
  SELECT
    target_account_id,
    target_profile_id,
    batch_id,
    entry.media_key,
    public.canonical_title_media_key(entry.media_key),
    entry.media_type,
    'playback_completed',
    entry.watched_at,
    'provider_import',
    target_provider,
    target_account_id
  FROM jsonb_to_recordset(entries) AS entry(
    media_key text,
    media_type text,
    watched_at timestamptz,
    source_kind text
  )
  WHERE entry.media_key IS NOT NULL
    AND entry.watched_at IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  UPDATE public.provider_import_batches
  SET row_count = inserted_count
  WHERE id = batch_id;

  FOR v_key IN
    SELECT DISTINCT key_value
    FROM (
      SELECT unnest(v_old_keys) AS key_value
      UNION
      SELECT entry.media_key AS key_value
      FROM jsonb_to_recordset(entries) AS entry(media_key text, media_type text, watched_at timestamptz, source_kind text)
    ) keys
    WHERE key_value IS NOT NULL
  LOOP
    PERFORM public.refresh_media_watch_summary(target_profile_id, v_key);
  END LOOP;

  RETURN inserted_count;
END;
$$;

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
  v_count integer := 0;
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

  FOR v_state IN SELECT * FROM jsonb_array_elements(COALESCE(p_states, '[]'::jsonb))
  LOOP
    v_duration_seconds := NULLIF((v_state->>'duration_seconds')::integer, 0);
    v_completed := COALESCE((v_state->>'completed')::boolean, false);

    IF v_completed THEN
      INSERT INTO public.watch_events (
        account_id, profile_id, media_key, title_media_key, media_type,
        event_type, occurred_at, position_seconds, duration_seconds, progress_bps,
        source_kind, source_provider, last_actor_account_id
      ) VALUES (
        p_account_id,
        p_profile_id,
        v_state->>'media_key',
        v_state->>'title_media_key',
        v_state->>'media_type',
        'playback_completed',
        COALESCE((v_state->>'occurred_at')::timestamptz, now()),
        (v_state->>'position_seconds')::integer,
        v_duration_seconds,
        (v_state->>'progress_bps')::integer,
        'provider_import',
        p_provider,
        p_account_id
      )
      ON CONFLICT DO NOTHING;

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
        COALESCE((v_state->>'occurred_at')::timestamptz, now()),
        'provider_import',
        p_provider,
        p_account_id,
        p_account_id
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

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

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
    mc.rating
  FROM public.watch_events we
  LEFT JOIN public.watch_media_card_cache mc ON mc.media_key = we.media_key
  WHERE we.profile_id = p_profile_id
    AND we.event_type IN ('playback_completed', 'marked_watched')
    AND (
      p_cursor_occurred_at IS NULL
      OR we.occurred_at < p_cursor_occurred_at
      OR (we.occurred_at = p_cursor_occurred_at AND we.id < p_cursor_id)
    )
  ORDER BY we.occurred_at DESC, we.id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100)) + 1;
END;
$$;

SELECT public.rebuild_media_watch_summary(NULL);

DROP TABLE IF EXISTS public.profile_media_state CASCADE;
DROP TABLE IF EXISTS public.watch_history CASCADE;
DROP TABLE IF EXISTS public.continue_watching_items CASCADE;

REVOKE ALL ON FUNCTION public.replace_provider_import_history(uuid, text, text, uuid, uuid, text, text, boolean, integer, text, text, text, uuid, integer, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_provider_import_playback_states(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_provider_import_history(uuid, text, text, uuid, uuid, text, text, boolean, integer, text, text, text, uuid, integer, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_provider_import_playback_states(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_watch_state(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_playback_state(uuid, text, text, text, integer, integer, smallint, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_watched_state(uuid, text, text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_continue_watching(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_continue_watching_page(uuid, integer, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_watch_history_page(uuid, integer, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_media_watch_history_page(uuid, text, integer, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_media_watch_summary(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_media_watch_summary(uuid) TO service_role;

COMMENT ON TABLE public.watch_events IS 'Append-only watch history ledger. Completion and manual watched-state facts only; provider is source metadata.';
COMMENT ON TABLE public.playback_progress IS 'Active resumable playback state only. Completed or manually watched items are removed.';
COMMENT ON TABLE public.media_watch_summary IS 'Derived watched-state projection per profile and playable media key. Rebuildable from watch_events.';
COMMENT ON FUNCTION public.list_watch_history_page(uuid, integer, timestamptz, uuid) IS 'Returns true chronological watch history events without collapsing rewatches.';
COMMENT ON FUNCTION public.list_media_watch_history_page(uuid, text, integer, timestamptz, uuid) IS 'Returns chronological watch history for a movie, episode, or show title.';
