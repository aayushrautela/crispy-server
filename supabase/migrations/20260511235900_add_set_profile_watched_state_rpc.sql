-- Migration: Add set_profile_watched_state RPC for mark/unmark watched operations
-- This RPC allows users to explicitly mark media as watched or unwatched
-- It updates profile_media_state, manages continue_watching_items, and records watch_history

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
    INSERT INTO public.profile_media_state (
      account_id,
      profile_id,
      media_key,
      title_media_key,
      media_type,
      watch_state,
      playback_status,
      play_count,
      last_watched_at,
      completed_at,
      last_activity_at,
      source_kind,
      source_provider,
      last_actor_account_id,
      created_at,
      updated_at
    )
    VALUES (
      v_account_id,
      p_profile_id,
      p_media_key,
      p_title_media_key,
      p_media_type,
      'watched',
      'completed',
      1,
      v_occurred_at,
      v_occurred_at,
      v_occurred_at,
      'local',
      NULL,
      auth.uid(),
      now(),
      now()
    )
    ON CONFLICT (profile_id, media_key)
    DO UPDATE SET
      watch_state = 'watched',
      playback_status = 'completed',
      play_count = COALESCE(profile_media_state.play_count, 0) + 1,
      last_watched_at = v_occurred_at,
      completed_at = v_occurred_at,
      last_activity_at = v_occurred_at,
      last_actor_account_id = auth.uid(),
      updated_at = now()
    WHERE profile_media_state.source_kind = 'local' AND profile_media_state.source_provider IS NULL;

    DELETE FROM public.continue_watching_items
    WHERE profile_id = p_profile_id
      AND title_media_key = p_title_media_key;

    INSERT INTO public.watch_history (
      account_id,
      profile_id,
      media_key,
      media_type,
      watched_at,
      source_kind,
      created_at
    )
    VALUES (
      v_account_id,
      p_profile_id,
      p_media_key,
      p_media_type,
      v_occurred_at,
      'local',
      now()
    )
    ON CONFLICT DO NOTHING;

  ELSIF p_watch_state = 'unwatched' THEN
    INSERT INTO public.profile_media_state (
      account_id,
      profile_id,
      media_key,
      title_media_key,
      media_type,
      watch_state,
      playback_status,
      position_seconds,
      duration_seconds,
      progress_bps,
      play_count,
      last_watched_at,
      completed_at,
      last_activity_at,
      source_kind,
      source_provider,
      last_actor_account_id,
      created_at,
      updated_at
    )
    VALUES (
      v_account_id,
      p_profile_id,
      p_media_key,
      p_title_media_key,
      p_media_type,
      'unwatched',
      'none',
      NULL,
      NULL,
      NULL,
      0,
      NULL,
      NULL,
      v_occurred_at,
      'local',
      NULL,
      auth.uid(),
      now(),
      now()
    )
    ON CONFLICT (profile_id, media_key)
    DO UPDATE SET
      watch_state = 'unwatched',
      playback_status = 'none',
      position_seconds = NULL,
      duration_seconds = NULL,
      progress_bps = NULL,
      last_watched_at = NULL,
      completed_at = NULL,
      last_activity_at = v_occurred_at,
      last_actor_account_id = auth.uid(),
      updated_at = now()
    WHERE profile_media_state.source_kind = 'local' AND profile_media_state.source_provider IS NULL;

    DELETE FROM public.watch_history
    WHERE profile_id = p_profile_id
      AND media_key = p_media_key
      AND source_kind = 'local';

    DELETE FROM public.continue_watching_items
    WHERE profile_id = p_profile_id
      AND title_media_key = p_title_media_key;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_profile_watched_state FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_profile_watched_state TO authenticated;

COMMENT ON FUNCTION public.set_profile_watched_state IS 'User RPC to mark media as watched or unwatched. Requires profile write access via RLS.';
