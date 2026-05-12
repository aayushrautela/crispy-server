CREATE OR REPLACE FUNCTION reco.service_create_run(p_input jsonb)
RETURNS reco.runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reco', 'public'
AS $$
DECLARE
  v_row reco.runs;
BEGIN
  INSERT INTO reco.runs (
    app_id,
    purpose,
    run_type,
    status,
    model_version,
    algorithm,
    input,
    metadata,
    started_at
  )
  VALUES (
    p_input->>'appId',
    COALESCE(p_input->>'purpose', 'recommendation-generation'),
    p_input->>'runType',
    COALESCE(p_input->>'status', 'running'),
    p_input->>'modelVersion',
    p_input->>'algorithm',
    COALESCE(p_input->'input', '{}'::jsonb),
    COALESCE(p_input->'metadata', '{}'::jsonb),
    now()
  )
  RETURNING * INTO v_row;

  INSERT INTO reco.run_logs (run_id, level, code, message, safe_context)
  VALUES (v_row.run_id, 'info', 'run_created', 'Recommendation run created', jsonb_build_object('appId', v_row.app_id, 'runType', v_row.run_type));

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION reco.service_update_run(p_run_id uuid, p_patch jsonb)
RETURNS reco.runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reco', 'public'
AS $$
DECLARE
  v_row reco.runs;
  v_status text;
BEGIN
  v_status := p_patch->>'status';

  UPDATE reco.runs
     SET status = COALESCE(v_status, status),
         progress = COALESCE(progress, '{}'::jsonb) || COALESCE(p_patch->'progress', '{}'::jsonb),
         output = CASE WHEN p_patch ? 'output' THEN COALESCE(p_patch->'output', '{}'::jsonb) ELSE output END,
         error = CASE WHEN p_patch ? 'error' THEN p_patch->'error' ELSE error END,
         completed_at = CASE WHEN v_status IN ('completed', 'failed', 'cancelled') THEN now() ELSE completed_at END,
         updated_at = now()
   WHERE run_id = p_run_id
     AND app_id = p_patch->>'appId'
  RETURNING * INTO v_row;

  IF v_row.run_id IS NULL THEN
    RAISE EXCEPTION 'recommendation_run_not_found';
  END IF;

  INSERT INTO reco.run_logs (run_id, level, code, message, safe_context)
  VALUES (v_row.run_id, 'info', 'run_updated', 'Recommendation run updated', jsonb_build_object('status', v_row.status, 'progress', v_row.progress));

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION reco.service_create_batch(p_run_id uuid, p_input jsonb)
RETURNS reco.batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reco', 'public'
AS $$
DECLARE
  v_row reco.batches;
  v_item_count integer;
  v_lease_seconds integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reco.runs WHERE run_id = p_run_id AND app_id = p_input->>'appId') THEN
    RAISE EXCEPTION 'recommendation_run_not_found';
  END IF;

  v_item_count := COALESCE(jsonb_array_length(COALESCE(p_input->'items', '[]'::jsonb)), 0);
  v_lease_seconds := COALESCE((p_input->>'leaseSeconds')::integer, 300);

  INSERT INTO reco.batches (
    run_id,
    app_id,
    status,
    snapshot_id,
    lease_id,
    lease_expires_at,
    item_count,
    items
  )
  VALUES (
    p_run_id,
    p_input->>'appId',
    COALESCE(p_input->>'status', 'leased'),
    NULLIF(p_input->>'snapshotId', '')::uuid,
    gen_random_uuid(),
    now() + make_interval(secs => v_lease_seconds),
    v_item_count,
    p_input->'items'
  )
  RETURNING * INTO v_row;

  INSERT INTO reco.run_logs (run_id, batch_id, level, code, message, safe_context)
  VALUES (p_run_id, v_row.batch_id, 'info', 'batch_created', 'Recommendation batch created', jsonb_build_object('itemCount', v_row.item_count));

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION reco.service_update_batch(p_run_id uuid, p_batch_id uuid, p_patch jsonb)
RETURNS reco.batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reco', 'public'
AS $$
DECLARE
  v_row reco.batches;
BEGIN
  UPDATE reco.batches
     SET status = COALESCE(p_patch->>'status', status),
         progress = COALESCE(progress, '{}'::jsonb) || COALESCE(p_patch->'progress', '{}'::jsonb),
         errors = CASE WHEN p_patch ? 'errors' THEN p_patch->'errors' ELSE errors END,
         updated_at = now()
   WHERE run_id = p_run_id
     AND batch_id = p_batch_id
     AND app_id = p_patch->>'appId'
  RETURNING * INTO v_row;

  IF v_row.batch_id IS NULL THEN
    RAISE EXCEPTION 'recommendation_batch_not_found';
  END IF;

  INSERT INTO reco.run_logs (run_id, batch_id, level, code, message, safe_context)
  VALUES (p_run_id, p_batch_id, 'info', 'batch_updated', 'Recommendation batch updated', jsonb_build_object('status', v_row.status, 'progress', v_row.progress));

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION reco.service_append_run_log(
  p_run_id uuid,
  p_batch_id uuid,
  p_level text,
  p_code text,
  p_message text,
  p_safe_context jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reco', 'public'
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_level NOT IN ('debug', 'info', 'warn', 'error') THEN
    RAISE EXCEPTION 'invalid_log_level';
  END IF;

  INSERT INTO reco.run_logs (run_id, batch_id, level, code, message, safe_context)
  VALUES (p_run_id, p_batch_id, p_level, p_code, p_message, COALESCE(p_safe_context, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION reco.service_replace_generated_list(
  p_account_id uuid,
  p_profile_id uuid,
  p_list_key text,
  p_items jsonb,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS reco.recommendation_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reco', 'public'
AS $$
DECLARE
  v_source_id uuid;
  v_list reco.recommendation_lists;
  v_item jsonb;
  v_position integer := 0;
  v_version integer;
BEGIN
  IF COALESCE(jsonb_array_length(p_items), 0) > 500 THEN
    RAISE EXCEPTION 'too_many_recommendation_items';
  END IF;

  INSERT INTO reco.sources (account_id, source_key, display_name, source_type, created_by_kind, created_by_id, metadata)
  VALUES (p_account_id, COALESCE(p_context->>'sourceKey', 'reco:default'), COALESCE(p_context->>'sourceName', 'Crispy Recommendations'), 'reco_engine', 'service', p_context->>'actorId', '{}'::jsonb)
  ON CONFLICT (account_id, source_key)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_source_id;

  UPDATE reco.recommendation_lists
     SET status = 'deleted', deleted_at = now(), replaced_at = now(), updated_at = now()
   WHERE profile_id = p_profile_id
     AND source_id = v_source_id
     AND list_key = p_list_key
     AND status = 'active'
     AND deleted_at IS NULL;

  INSERT INTO reco.recommendation_lists (
    account_id,
    profile_id,
    source_id,
    list_key,
    title,
    description,
    algorithm_key,
    model_version,
    etag,
    item_count,
    generated_at,
    expires_at,
    request_hash,
    created_by_kind,
    created_by_id,
    updated_by_kind,
    updated_by_id,
    metadata
  )
  VALUES (
    p_account_id,
    p_profile_id,
    v_source_id,
    p_list_key,
    p_context->>'title',
    p_context->>'description',
    p_context->>'algorithm',
    p_context->>'modelVersion',
    encode(gen_random_bytes(16), 'hex'),
    COALESCE(jsonb_array_length(p_items), 0),
    COALESCE(NULLIF(p_context->>'generatedAt', '')::timestamptz, now()),
    NULLIF(p_context->>'expiresAt', '')::timestamptz,
    p_context->>'requestHash',
    'service',
    p_context->>'actorId',
    'service',
    p_context->>'actorId',
    COALESCE(p_context->'metadata', '{}'::jsonb)
  )
  RETURNING * INTO v_list;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    INSERT INTO reco.recommendation_list_items (
      list_id,
      account_id,
      profile_id,
      source_id,
      list_key,
      position,
      media_key,
      media_type,
      tmdb_id,
      show_tmdb_id,
      season_number,
      episode_number,
      provider_ids,
      raw_ref,
      score,
      reason_code,
      reason_public,
      generated_at,
      resolution_status
    )
    VALUES (
      v_list.id,
      p_account_id,
      p_profile_id,
      v_source_id,
      p_list_key,
      v_position,
      v_item->>'mediaKey',
      COALESCE(v_item->>'mediaType', v_item->>'type'),
      NULLIF(v_item->>'tmdbId', '')::integer,
      NULLIF(v_item->>'showTmdbId', '')::integer,
      NULLIF(v_item->>'seasonNumber', '')::integer,
      NULLIF(v_item->>'episodeNumber', '')::integer,
      COALESCE(v_item->'providerIds', '{}'::jsonb),
      v_item,
      NULLIF(v_item->>'score', '')::numeric,
      v_item->>'reasonCode',
      v_item->>'reasonPublic',
      v_list.generated_at,
      CASE WHEN v_item ? 'mediaKey' THEN 'resolved' ELSE 'not_attempted' END
    );
    v_position := v_position + 1;
  END LOOP;

  SELECT COALESCE(max(version), 0) + 1 INTO v_version
    FROM reco.recommendation_list_versions
   WHERE list_id = v_list.id;

  INSERT INTO reco.recommendation_list_versions (list_id, version, schema_version, etag, item_count, request_hash, actor_kind, actor_id, summary)
  VALUES (v_list.id, v_version, v_list.schema_version, v_list.etag, v_list.item_count, v_list.request_hash, 'service', p_context->>'actorId', jsonb_build_object('listKey', p_list_key));

  INSERT INTO reco.audit_events (event, account_id, profile_id, principal_kind, principal_id, source_id, source_key, list_key, version, item_count, request_hash, result, metadata)
  VALUES ('recommendation_list_replaced', p_account_id, p_profile_id, 'service', p_context->>'actorId', v_source_id, COALESCE(p_context->>'sourceKey', 'reco:default'), p_list_key, v_version, v_list.item_count, v_list.request_hash, 'success', '{}'::jsonb);

  RETURN v_list;
END;
$$;

REVOKE EXECUTE ON FUNCTION reco.service_create_run(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION reco.service_update_run(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION reco.service_create_batch(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION reco.service_update_batch(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION reco.service_append_run_log(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION reco.service_replace_generated_list(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION reco.service_create_run(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION reco.service_update_run(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION reco.service_create_batch(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION reco.service_update_batch(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION reco.service_append_run_log(uuid, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION reco.service_replace_generated_list(uuid, uuid, text, jsonb, jsonb) TO service_role;
