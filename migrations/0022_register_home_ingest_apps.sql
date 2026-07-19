-- Register the three home ingest pipeline service apps + their scopes + grants.
--
-- The buildOfficialRecommenderPrincipal() hard-coded shortcut in
-- src/http/plugins/app-auth.plugin.ts is replaced by DB-backed row lookups so
-- the same auth framework (app_registry + app_scopes + app_grants +
-- app_source_ownership) is the single source of truth for service principals.
--
-- Three apps are registered, matching the home ingest producer model:
--
--   reco       -- external personalized recommendation engine. System-wide:
--                 can read any profile's signals, push any profile's home
--                 lists, manage recommendation runs/batches. Authenticated by
--                 the existing single-shot RECOMMENDER_TO_MAIN_SERVICE_TOKEN
--                 _HASH env var (mapped to an app_keys row by the auth plugin).
--   custom     -- external curated-lists service. PAT-based per-user push
--                 (pushes result lists on behalf of a specific user); cannot
--                 read system-wide signals.
--   fallback   -- internal deterministic default-rail source. System-wide
--                 signal read + fallback-list write (called by the pipeline
--                 on miss/failure).
--
-- Idempotent: re-running is a no-op.

INSERT INTO app_registry (app_id, name, description, status, owner_team, allowed_environments, principal_type)
VALUES
  ('reco',     'Crispy Recommendation Engine', 'External personalized recommendation engine. Reads profile signals and pushes home lists.', 'active', 'crispy', ARRAY['*'], 'service_app'),
  ('custom',   'Crispy Custom Lists Service',  'External custom-lists service. Pushes home lists on behalf of an individual user via PAT.', 'active', 'crispy', ARRAY['*'], 'service_app'),
  ('fallback', 'Crispy Fallback Source',       'Internal deterministic default-rail source invoked by the pipeline on miss/failure.', 'active', 'crispy', ARRAY['*'], 'service_app')
ON CONFLICT (app_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  owner_team = EXCLUDED.owner_team,
  updated_at = now();

-- Scopes: reco and fallback share the system-wide signal-read + write scope.
-- custom does not receive any system-wide AppScope since its access is per-user
-- via PAT (different auth model).
INSERT INTO app_scopes (app_id, scope, status)
SELECT app_id, scope, 'active'
FROM (VALUES
  ('reco', 'apps:self:read'),
  ('reco', 'accounts:all:read'),
  ('reco', 'accounts:all:write'),
  ('reco', 'profiles:eligible:read'),
  ('reco', 'profiles:eligible:snapshot:create'),
  ('reco', 'profiles:eligible:snapshot:read'),
  ('reco', 'profiles:signals:read'),
  ('reco', 'recommendations:service-lists:write'),
  ('reco', 'recommendations:service-lists:batch-write'),
  ('reco', 'recommendations:runs:write'),
  ('reco', 'recommendations:batches:write'),
  ('reco', 'recommendations:backfills:read'),
  ('reco', 'apps:audit:read'),
  ('reco', 'apps:audit:write'),
  ('fallback', 'apps:self:read'),
  ('fallback', 'accounts:all:read'),
  ('fallback', 'profiles:signals:read'),
  ('fallback', 'recommendations:service-lists:write')
) AS rows(app_id, scope)
ON CONFLICT (app_id, scope) DO UPDATE SET status = 'active';

-- Grants: mirrored from buildOfficialRecommenderPrincipal() for reco; fallback
-- gets profileSignals read + recommendationList write for fallback source.
INSERT INTO app_grants (app_id, resource_type, resource_id, purpose, actions, constraints, status)
SELECT app_id, resource_type, resource_id, purpose, actions, constraints, 'active'::text
FROM (VALUES
  ('reco',     'profileSignals',      '*', 'recommendation-generation', ARRAY['read']::text[],                               '{}'::jsonb),
  ('reco',     'recommendationList',  '*', 'recommendation-generation', ARRAY['read','write','create','update']::text[],     '{"source":"reco","maxItems":1000}'::jsonb),
  ('reco',     'profileEligibility', '*', 'recommendation-generation', ARRAY['read']::text[],                               '{}'::jsonb),
  ('reco',     'recommendationRun',   '*', 'recommendation-generation', ARRAY['create','update','claim']::text[],           '{}'::jsonb),
  ('reco',     'recommendationBatch', '*', 'recommendation-generation', ARRAY['create','update','claim']::text[],           '{}'::jsonb),
  ('reco',     'auditEvents',         '*', 'recommendation-generation', ARRAY['read']::text[],                               '{}'::jsonb),
  ('fallback', 'profileSignals',      '*', 'recommendation-generation', ARRAY['read']::text[],                               '{}'::jsonb),
  ('fallback', 'recommendationList',  '*', 'recommendation-generation', ARRAY['read','write','create','update']::text[],     '{"source":"fallback","maxItems":1000}'::jsonb)
) AS rows(app_id, resource_type, resource_id, purpose, actions, constraints);

-- Source ownership: which app owns which source string on pushed lists.
INSERT INTO app_source_ownership (source, app_id, allowed_list_keys, status)
VALUES
  ('reco',     'reco',     '[]'::jsonb, 'active'),
  ('fallback', 'fallback', '[]'::jsonb, 'active')
ON CONFLICT (source) DO UPDATE SET app_id = EXCLUDED.app_id, status = 'active';

-- Rate-limit policy: same as the hard-coded reco principal defaults.
INSERT INTO app_rate_limit_policies (app_id)
VALUES
  ('reco'),
  ('fallback')
ON CONFLICT (app_id) DO NOTHING;

-- No app_keys rows are inserted for reco here. The existing
-- RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH env var continues to authenticate the
-- reco service; the auth plugin, on env-var match, resolves the principal from
-- app_registry/app_scopes/app_grants/app_source_ownership rows for app_id='reco'
-- (rather than a hard-coded principal in code). This is the single source of
-- truth for the principal shape while keeping the existing deployment token.
--
-- When fallback goes live, an operator inserts an app_keys row for it
-- (e.g. 'fallback-default'), and fallback's service token authenticates via
-- the standard requireAppAuth path. The same framework covers both.
