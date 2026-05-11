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
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id AND account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Profile does not belong to account';
  END IF;

  DELETE FROM public.continue_watching_items
  WHERE profile_id = p_profile_id
    AND source_kind = 'provider_import'
    AND source_provider = p_provider;

  FOR v_state IN SELECT * FROM jsonb_array_elements(p_states)
  LOOP
    v_duration_seconds := NULLIF((v_state->>'duration_seconds')::integer, 0);

    INSERT INTO public.profile_media_state (
      account_id,
      profile_id,
      media_key,
      title_media_key,
      media_type,
      playback_status,
      position_seconds,
      duration_seconds,
      progress_bps,
      watch_state,
      last_activity_at,
      completed_at,
      source_kind,
      source_provider,
      last_actor_account_id
    )
    VALUES (
      p_account_id,
      p_profile_id,
      v_state->>'media_key',
      v_state->>'title_media_key',
      v_state->>'media_type',
      CASE WHEN (v_state->>'completed')::boolean THEN 'completed' ELSE 'in_progress' END,
      (v_state->>'position_seconds')::integer,
      v_duration_seconds,
      (v_state->>'progress_bps')::integer,
      CASE WHEN (v_state->>'completed')::boolean THEN 'watched' ELSE 'unknown' END,
      (v_state->>'occurred_at')::timestamptz,
      CASE WHEN (v_state->>'completed')::boolean THEN (v_state->>'occurred_at')::timestamptz ELSE NULL END,
      'provider_import',
      p_provider,
      p_account_id
    )
    ON CONFLICT (profile_id, media_key) DO UPDATE SET
      title_media_key = EXCLUDED.title_media_key,
      media_type = EXCLUDED.media_type,
      playback_status = EXCLUDED.playback_status,
      position_seconds = EXCLUDED.position_seconds,
      duration_seconds = EXCLUDED.duration_seconds,
      progress_bps = EXCLUDED.progress_bps,
      watch_state = EXCLUDED.watch_state,
      last_activity_at = EXCLUDED.last_activity_at,
      completed_at = EXCLUDED.completed_at,
      source_kind = EXCLUDED.source_kind,
      source_provider = EXCLUDED.source_provider,
      last_actor_account_id = EXCLUDED.last_actor_account_id,
      updated_at = now();

    IF NOT (v_state->>'completed')::boolean THEN
      INSERT INTO public.continue_watching_items (
        account_id,
        profile_id,
        title_media_key,
        playable_media_key,
        media_type,
        position_seconds,
        duration_seconds,
        progress_bps,
        last_activity_at,
        source_kind,
        source_provider,
        last_actor_account_id
      )
      VALUES (
        p_account_id,
        p_profile_id,
        v_state->>'title_media_key',
        v_state->>'media_key',
        v_state->>'media_type',
        (v_state->>'position_seconds')::integer,
        v_duration_seconds,
        (v_state->>'progress_bps')::integer,
        (v_state->>'occurred_at')::timestamptz,
        'provider_import',
        p_provider,
        p_account_id
      )
      ON CONFLICT (profile_id, title_media_key) DO UPDATE SET
        playable_media_key = EXCLUDED.playable_media_key,
        media_type = EXCLUDED.media_type,
        position_seconds = EXCLUDED.position_seconds,
        duration_seconds = EXCLUDED.duration_seconds,
        progress_bps = EXCLUDED.progress_bps,
        last_activity_at = EXCLUDED.last_activity_at,
        source_kind = EXCLUDED.source_kind,
        source_provider = EXCLUDED.source_provider,
        last_actor_account_id = EXCLUDED.last_actor_account_id,
        dismissed_at = NULL,
        updated_at = now();
    END IF;

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  RETURN v_inserted_count;
END;
$$;
