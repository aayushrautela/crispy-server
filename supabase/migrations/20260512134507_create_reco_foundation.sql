CREATE SCHEMA IF NOT EXISTS reco;

CREATE OR REPLACE FUNCTION reco.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'reco', 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE reco.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  display_name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('built_in', 'external', 'account_api', 'reco_engine')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('system', 'user', 'pat', 'service')),
  created_by_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, source_key)
);

CREATE TABLE reco.recommendation_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES reco.sources(id),
  list_key text NOT NULL,
  title text,
  description text,
  algorithm_key text,
  model_version text,
  schema_version text NOT NULL DEFAULT '2026-05-01',
  etag text NOT NULL,
  item_count integer NOT NULL CHECK (item_count >= 0 AND item_count <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  generated_at timestamptz,
  expires_at timestamptz,
  replaced_at timestamptz,
  deleted_at timestamptz,
  request_hash text,
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('system', 'user', 'pat', 'service')),
  created_by_id text,
  updated_by_kind text NOT NULL CHECK (updated_by_kind IN ('system', 'user', 'pat', 'service')),
  updated_by_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reco.recommendation_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES reco.recommendation_lists(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES reco.sources(id),
  list_key text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  media_key text,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'show', 'season', 'episode')),
  tmdb_id integer,
  show_tmdb_id integer,
  season_number integer,
  episode_number integer,
  provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric,
  reason_code text,
  reason_public text,
  generated_at timestamptz,
  resolution_status text NOT NULL DEFAULT 'not_attempted' CHECK (resolution_status IN ('not_attempted', 'resolved', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, position)
);

CREATE TABLE reco.recommendation_list_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES reco.recommendation_lists(id) ON DELETE CASCADE,
  version integer NOT NULL,
  schema_version text NOT NULL,
  etag text NOT NULL,
  item_count integer NOT NULL,
  request_hash text,
  actor_kind text NOT NULL CHECK (actor_kind IN ('system', 'user', 'pat', 'service')),
  actor_id text,
  idempotency_key_hash text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, version)
);

CREATE TABLE reco.taste_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_id uuid REFERENCES reco.sources(id),
  source_key text NOT NULL,
  schema_version text NOT NULL DEFAULT '2026-05-01',
  summary text,
  locale text,
  genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_actors jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_directors jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_type_pref jsonb NOT NULL DEFAULT '{}'::jsonb,
  rating_tendency jsonb NOT NULL DEFAULT '{}'::jsonb,
  decade_preferences jsonb NOT NULL DEFAULT '[]'::jsonb,
  signals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  signal_count integer NOT NULL DEFAULT 0 CHECK (signal_count >= 0 AND signal_count <= 250),
  watching_pace text,
  ai_summary text,
  source text NOT NULL,
  request_hash text,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  deleted_at timestamptz,
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('system', 'user', 'pat', 'service')),
  created_by_id text,
  updated_by_kind text NOT NULL CHECK (updated_by_kind IN ('system', 'user', 'pat', 'service')),
  updated_by_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reco.taste_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taste_profile_id uuid NOT NULL REFERENCES reco.taste_profiles(id) ON DELETE CASCADE,
  version integer NOT NULL,
  schema_version text NOT NULL,
  summary text,
  locale text,
  signals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  signal_count integer NOT NULL DEFAULT 0,
  request_hash text,
  actor_kind text NOT NULL CHECK (actor_kind IN ('system', 'user', 'pat', 'service')),
  actor_id text,
  idempotency_key_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (taste_profile_id, version)
);

CREATE TABLE reco.write_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  principal_kind text NOT NULL CHECK (principal_kind IN ('user', 'pat', 'service')),
  principal_id text NOT NULL,
  operation_key text NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_json jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, principal_kind, principal_id, operation_key, idempotency_key_hash)
);

CREATE TABLE reco.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  account_id uuid,
  profile_id uuid,
  principal_kind text,
  principal_id text,
  source_id uuid,
  source_key text,
  list_key text,
  version integer,
  item_count integer,
  signal_count integer,
  request_hash text,
  idempotency_key_hash text,
  result text NOT NULL,
  ip inet,
  user_agent text,
  safe_error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reco.outbox_events (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE TABLE reco.runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  purpose text NOT NULL,
  run_type text NOT NULL CHECK (run_type IN ('incremental', 'snapshot', 'backfill', 'full_refresh')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  model_version text,
  algorithm text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reco.batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES reco.runs(run_id) ON DELETE CASCADE,
  app_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('leased', 'running', 'completed', 'failed', 'cancelled', 'expired')),
  snapshot_id uuid,
  lease_id uuid,
  lease_expires_at timestamptz,
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  items jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reco.run_logs (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES reco.runs(run_id) ON DELETE CASCADE,
  batch_id uuid REFERENCES reco.batches(batch_id) ON DELETE SET NULL,
  level text NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  code text,
  message text NOT NULL,
  safe_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reco.backfill_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  snapshot_id uuid,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'expired')),
  priority integer NOT NULL DEFAULT 0,
  estimated_profile_count integer NOT NULL DEFAULT 0 CHECK (estimated_profile_count >= 0),
  profiles_completed integer NOT NULL DEFAULT 0 CHECK (profiles_completed >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE UNIQUE INDEX recommendation_lists_active_unique ON reco.recommendation_lists (profile_id, source_id, list_key) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX recommendation_lists_account_profile_updated_idx ON reco.recommendation_lists (account_id, profile_id, updated_at DESC);
CREATE INDEX recommendation_list_items_list_position_idx ON reco.recommendation_list_items (list_id, position);
CREATE UNIQUE INDEX taste_profiles_active_unique ON reco.taste_profiles (profile_id, source_key) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX write_idempotency_keys_expires_idx ON reco.write_idempotency_keys (expires_at);
CREATE INDEX audit_events_account_created_idx ON reco.audit_events (account_id, created_at DESC);
CREATE INDEX audit_events_profile_created_idx ON reco.audit_events (profile_id, created_at DESC);
CREATE UNIQUE INDEX outbox_events_idempotency_unique ON reco.outbox_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX runs_app_status_created_idx ON reco.runs (app_id, status, created_at DESC);
CREATE INDEX batches_app_run_status_created_idx ON reco.batches (app_id, run_id, status, created_at DESC);
CREATE INDEX batches_active_lease_idx ON reco.batches (lease_expires_at) WHERE status IN ('leased', 'running') AND lease_expires_at IS NOT NULL;
CREATE INDEX run_logs_run_created_idx ON reco.run_logs (run_id, created_at DESC);

CREATE TRIGGER sources_set_updated_at BEFORE UPDATE ON reco.sources FOR EACH ROW EXECUTE FUNCTION reco.set_updated_at();
CREATE TRIGGER recommendation_lists_set_updated_at BEFORE UPDATE ON reco.recommendation_lists FOR EACH ROW EXECUTE FUNCTION reco.set_updated_at();
CREATE TRIGGER taste_profiles_set_updated_at BEFORE UPDATE ON reco.taste_profiles FOR EACH ROW EXECUTE FUNCTION reco.set_updated_at();
CREATE TRIGGER runs_set_updated_at BEFORE UPDATE ON reco.runs FOR EACH ROW EXECUTE FUNCTION reco.set_updated_at();
CREATE TRIGGER batches_set_updated_at BEFORE UPDATE ON reco.batches FOR EACH ROW EXECUTE FUNCTION reco.set_updated_at();
CREATE TRIGGER backfill_assignments_set_updated_at BEFORE UPDATE ON reco.backfill_assignments FOR EACH ROW EXECUTE FUNCTION reco.set_updated_at();

ALTER TABLE reco.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.recommendation_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.recommendation_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.recommendation_list_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.taste_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.taste_profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.write_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.run_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reco.backfill_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sources_profile_member_read ON reco.sources FOR SELECT TO authenticated USING (account_id = auth.uid());
CREATE POLICY recommendation_lists_member_read ON reco.recommendation_lists FOR SELECT TO authenticated USING (private.is_profile_member(profile_id));
CREATE POLICY recommendation_list_items_member_read ON reco.recommendation_list_items FOR SELECT TO authenticated USING (private.is_profile_member(profile_id));
CREATE POLICY recommendation_list_versions_member_read ON reco.recommendation_list_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM reco.recommendation_lists l WHERE l.id = list_id AND private.is_profile_member(l.profile_id)));
CREATE POLICY taste_profiles_member_read ON reco.taste_profiles FOR SELECT TO authenticated USING (private.is_profile_member(profile_id));
CREATE POLICY taste_profile_versions_member_read ON reco.taste_profile_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM reco.taste_profiles t WHERE t.id = taste_profile_id AND private.is_profile_member(t.profile_id)));

REVOKE ALL ON SCHEMA reco FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA reco TO authenticated, service_role;
GRANT SELECT ON reco.sources, reco.recommendation_lists, reco.recommendation_list_items, reco.recommendation_list_versions, reco.taste_profiles, reco.taste_profile_versions TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA reco TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA reco TO service_role;
