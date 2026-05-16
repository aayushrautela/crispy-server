# Supabase Auth-Only App Data Architecture Spec

## Goal

Move all product/application data out of Supabase and into the server-owned Postgres database. Keep Supabase only as the identity provider and JWT issuer.

This is not a data migration spec. It is the target production architecture and implementation plan for local tables, ownership boundaries, and code alignment.

## Tooling Assumption

Both Supabase MCP and DBHub MCP are disposable inspection/admin tools for planning, verification, and one-off cleanup. They are not runtime architecture dependencies and should not be required by the application after this refactor.

## Non-goals

- Do not use Supabase PostgREST, Supabase RPCs, or Supabase RLS for app data.
- Do not store metadata cache in user-owned tables.
- Do not make Redis or derived read models the source of truth.
- Do not tightly couple user state to third-party metadata cache rows with hard foreign keys.

## Architecture Principles

1. Supabase Auth is the only Supabase dependency for runtime auth.
2. Server Postgres is the source of truth for all app data.
3. User data and metadata cache are separate bounded contexts.
4. User data is private, durable, transactional, auditable, and keyed by `account_id` / `profile_id`.
5. Metadata cache is shared, rebuildable, TTL-based, and keyed by stable external/content identifiers.
6. Read models are denormalized, disposable, and rebuilt from source tables/events.
7. Cross-context relationships use stable string/UUID references, not tight FK coupling unless both tables are in the same bounded context.
8. All authorization is enforced in API/service code and database roles, not Supabase RLS.

## Target Data Boundaries

### Supabase

Keep:

- `auth.users`
- Supabase JWT/JWKS verification
- Auth admin API only where required, such as deleting auth users

Remove runtime dependence on:

- Supabase app tables
- Supabase service-role data client
- Supabase user-scoped data client
- Supabase RPCs for product data
- Supabase RLS policies for product data

### Local Postgres Schemas

Use schemas to enforce ownership and keep future scaling options open.

```text
identity
  accounts
  profiles
  profile_members
  account_preferences
  profile_preferences
  account_entitlements

private
  account_secrets
  personal_access_tokens
  provider_tokens / provider_credentials

user_state
  watch_events
  playback_progress
  media_watch_summary
  watch_sessions
  profile_list_items
  profile_ratings
  provider_connections
  provider_oauth_states
  provider_import_batches

metadata
  content_items
  content_provider_refs
  tmdb_api_responses
  tmdb_titles
  tmdb_tv_seasons
  tmdb_tv_episodes
  tmdb_external_ids
  tmdb_people
  tmdb_collections
  tmdb_search_cache
  imdb_ratings
  watch_media_card_cache

recommendation
  sources
  taste_profiles
  taste_profile_versions
  recommendation_lists
  recommendation_list_items
  recommendation_list_versions
  write_idempotency_keys
  outbox_events
  runs
  batches
  run_logs
  backfill_assignments

read_model
  continue_watching_cards
  profile_library_cards
  profile_watch_history_cards
  profile_recommendation_cards
  profile_episodic_follow_state
  profile_eligibility_projections
  profile_signal_versions

ops
  app_registry
  app_keys
  app_scopes
  app_grants
  app_source_ownership
  app_rate_limit_policies
  app_audit_events
  admin_bulk_jobs
  admin_bulk_job_targets
  admin_bulk_job_events
  service_outbox_events
```

Physical separation can come later. Start with one managed Postgres cluster, separate schemas, separate DB roles, separate migrations, and clear access rules.

## Source-of-Truth Rules

### Identity/User Tables

Source of truth for:

- Account mirror of Supabase Auth user
- Profile ownership/membership
- User and profile preferences
- Entitlements
- Account-level encrypted settings/secrets
- Personal access tokens

`identity.accounts.id` should equal the Supabase Auth user UUID unless there is a strong reason to use a separate internal ID. This keeps JWT subject mapping simple and avoids an unnecessary lookup identity translation layer.

### User State Tables

Source of truth for:

- Watch history ledger
- Current playback progress
- Watched summary projection if maintained transactionally
- Watchlist/favorites
- Ratings
- Provider imports and connections

Rules:

- Every row must include `account_id` or `profile_id` where applicable.
- Watch event tables should be append-oriented where possible.
- Summary tables must be rebuildable from watch events.
- Provider imports should use idempotency keys/import batches to avoid duplicate writes.

### Metadata Cache Tables

Source of truth only for cached third-party metadata, not user intent.

Rules:

- No `account_id` or `profile_id` in shared metadata tables.
- Key by provider IDs: `tmdb_id`, `imdb_id`, `media_key`, `content_id`, etc.
- Include `fetched_at`, `expires_at`, `fresh_until`, `stale_until`, or equivalent TTL fields.
- Safe to purge and refetch.
- No hard FK from user-state rows to volatile metadata cache rows.

User state should reference metadata through stable keys like `media_key`, `title_media_key`, `tmdb_id`, or `content_id` when available.

### Read Models

Read models are derived projections used for fast API responses.

Examples:

- Continue watching cards
- Library/list cards
- Watch history cards
- Calendar/next episode state
- Recommendation panels
- Eligibility/profile signal projections

Rules:

- Read models may duplicate metadata and user state fields.
- They are not authoritative.
- They must be rebuildable from source tables plus metadata cache.
- They can be refreshed synchronously for simple writes or asynchronously via outbox/projectors.

## Scaling Path

1. Single Postgres cluster with schemas and indexes.
2. PgBouncer / connection pooling.
3. Read replicas for heavy read APIs.
4. Redis/Dragonfly cache for hot ephemeral reads.
5. Table partitioning:
   - `watch_events` by time and/or hash/profile.
   - audit/outbox logs by time.
   - metadata response cache by purge/expiration windows.
6. Dedicated metadata Postgres cluster if metadata cache load competes with user writes.
7. Kafka/Redpanda if outbox polling becomes insufficient.
8. Separate services/databases per bounded context only when operational metrics justify it.

## Authorization Model

Request flow:

```text
Client -> API with Supabase JWT
API -> verify JWT using Supabase JWKS
API -> local account bootstrap/load by JWT sub
API -> service-layer authorization checks
API -> local Postgres queries using server DB credentials
```

Rules:

- JWT `sub` maps to `identity.accounts.id`.
- API must check account/profile membership before every profile-scoped operation.
- PAT auth reads local `private.personal_access_tokens`.
- Service-to-service/admin access uses local app keys/grants, not Supabase service role.
- Database roles should prevent accidental cross-schema writes from the wrong service module where practical.

## Local Migration Plan

Create forward migrations in `/migrations`. Do not reuse Supabase migrations directly as-is; translate them into local, schema-owned SQL.

### Phase 1: Foundation Schemas and Roles

Add migration:

- Create schemas: `identity`, `private`, `user_state`, `metadata`, `recommendation`, `read_model`, `ops`.
- Revoke broad public access.
- Add service roles if managed locally:
  - `api_svc`
  - `worker_svc`
  - `metadata_svc`
  - `recommendation_svc`
  - `admin_svc`
- Grant least-privilege schema access.

### Phase 2: Identity and Private Tables

Create:

- `identity.accounts`
- `identity.profiles`
- `identity.profile_members`
- `identity.account_preferences`
- `identity.profile_preferences`
- `identity.account_entitlements`
- `private.account_secrets`
- `private.personal_access_tokens`

Add indexes:

- `accounts(email)` where useful
- `profiles(account_id, deleted_at)`
- `profile_members(account_id, profile_id)`
- JSONB GIN indexes only for preference fields that are queried, not blindly

### Phase 3: User State Tables

Create:

- `user_state.watch_events`
- `user_state.playback_progress`
- `user_state.media_watch_summary`
- `user_state.watch_sessions`
- `user_state.profile_list_items`
- `user_state.profile_ratings`
- `user_state.provider_connections`
- `user_state.provider_oauth_states`
- `user_state.provider_import_batches`

Important indexes:

- `watch_events(profile_id, occurred_at desc)`
- `watch_events(profile_id, title_media_key, occurred_at desc)`
- `watch_events(profile_id, media_key, occurred_at desc)`
- `playback_progress(profile_id, last_activity_at desc)`
- `media_watch_summary(profile_id, title_media_key)`
- `profile_list_items(profile_id, list_kind, added_at desc)`
- `profile_ratings(profile_id, rated_at desc)`
- `provider_import_batches(account_id, profile_id, imported_at desc)`

### Phase 4: Metadata Cache Tables

Keep or move existing local metadata tables into the `metadata` schema.

Create/align:

- `metadata.content_items`
- `metadata.content_provider_refs`
- `metadata.tmdb_api_responses`
- `metadata.tmdb_titles`
- `metadata.tmdb_tv_seasons`
- `metadata.tmdb_tv_episodes`
- `metadata.tmdb_external_ids`
- `metadata.tmdb_people`
- `metadata.tmdb_collections`
- `metadata.tmdb_search_cache`
- `metadata.imdb_ratings`
- `metadata.watch_media_card_cache`

Important indexes:

- Provider lookup indexes on external IDs
- Expiration indexes on `expires_at`, `purge_at`, `stale_until`
- `watch_media_card_cache(media_key)`
- `tmdb_titles(media_type, tmdb_id)`
- `tmdb_external_ids(source, external_id, media_type)`

### Phase 5: Recommendation and Ops Tables

Create/align:

- `recommendation.sources`
- `recommendation.taste_profiles`
- `recommendation.taste_profile_versions`
- `recommendation.recommendation_lists`
- `recommendation.recommendation_list_items`
- `recommendation.recommendation_list_versions`
- `recommendation.write_idempotency_keys`
- `recommendation.outbox_events`
- `recommendation.runs`
- `recommendation.batches`
- `recommendation.run_logs`
- `recommendation.backfill_assignments`
- `ops.app_*`
- `ops.admin_bulk_*`
- `ops.service_outbox_events`

Recommendation rows may reference `identity.accounts` and `identity.profiles`, but should reference metadata by stable media/content keys rather than requiring metadata rows to exist.

### Phase 6: Read Models and Projectors

Create read-model tables only for API shapes that need speed.

Start with:

- `read_model.profile_episodic_follow_state`
- `read_model.profile_eligibility_projections`
- `read_model.profile_signal_versions`
- Optional card projections for continue-watching/library/history/recommendations

Use outbox/projector workers to maintain these if synchronous route writes become too slow.

## Code Alignment Plan

### Phase A: Keep Supabase Auth, Remove Supabase Data Clients

Files to change:

- `src/lib/supabase.ts`
- `src/http/plugins/auth.ts`
- `src/lib/jwks.ts`
- `src/config/env.ts`

Target:

- Keep JWT verification in `jwks.ts`.
- Keep Supabase URL/publishable key/JWKS config.
- Stop requiring Supabase service-role/admin key for normal runtime app-data access.
- Replace `bootstrap_account` RPC with local `identity.accounts` upsert.
- Remove `createSupabaseUserClient` from app-data paths.
- Keep Supabase Auth Admin only in `external-auth-admin.service.ts` if needed.

### Phase B: Rewire Dependency Injection

File:

- `src/http/app.ts`

Target:

- Instantiate local SQL account/profile/PAT/settings services.
- Always use SQL recommendation run/batch repositories.
- Remove conditional selection of Supabase repositories based on service-role key.
- Register routes with local services only.

### Phase C: Replace Account/Profile/PAT Services

Replace Supabase-backed implementations:

- `src/modules/users/supabase-account-settings.repo.ts`
- `src/modules/auth/supabase-personal-access-token.service.ts`
- `src/modules/profiles/supabase-profile.service.ts`
- `src/modules/profiles/profile-settings.repo.ts`

Use or rebuild local SQL equivalents:

- `src/modules/users/account-settings.repo.ts`
- `src/modules/auth/personal-access-token.repo.ts`
- `src/modules/profiles/profile.repo.ts`
- `src/modules/users/user.repo.ts`

Target behavior:

- Local account bootstrap from JWT subject.
- Local profile CRUD/membership checks.
- Local account/profile preferences.
- Local PAT create/list/revoke/authenticate.
- Local encrypted account/provider secrets.

### Phase D: Replace Watch RPC Layer

Files:

- `src/modules/integrations/supabase-user-watch.service.ts`
- `src/http/routes/watch.ts`

Target:

- Create local `WatchService` / `WatchRepository` backed by `user_state` tables.
- Reimplement current RPC behavior locally:
  - list continue watching
  - list profile list items
  - list profile ratings
  - list watch history
  - get profile watch state
  - record playback state
  - dismiss continue watching
  - set/delete list item
  - set/delete rating
  - set watched/unwatched state
- Route authorization uses `request.auth.accountId` and local profile membership.
- Routes no longer require a Supabase user session token except normal JWT auth.
- PAT support can be allowed where scopes permit.

### Phase E: Replace Admin/Service Watch Reads

Replace:

- `src/modules/integrations/supabase-admin-watch-read.service.ts`

Update callers:

- `src/modules/recommendations/profile-input-signal.facade.ts`
- `src/modules/watch/episodic-follow.service.ts`
- `src/modules/calendar/calendar-builder.service.ts`

Target:

- Read watch/progress/list/rating data from `user_state`.
- Keep metadata enrichment through local metadata cache.

### Phase F: Replace Provider Import Supabase Writer

Files:

- `src/modules/integrations/provider-import.service.ts`
- `src/modules/integrations/supabase-provider-history-writer.ts`
- `src/modules/integrations/provider-token-access.service.ts`

Target:

- Replace Supabase RPC writer with local transactional provider import writer.
- Provider imports write to:
  - `user_state.provider_import_batches`
  - `user_state.watch_events`
  - `user_state.profile_list_items`
  - `user_state.profile_ratings`
  - `user_state.playback_progress`
  - `user_state.media_watch_summary`
- Provider token access uses local profile ownership and local encrypted credentials.

### Phase G: Recommendation/Admin APIs Local-Only

Files:

- `src/modules/apps/recommendation-run.repo.ts`
- `src/modules/apps/recommendation-batch.repo.ts`
- `src/http/routes/admin-api.ts`
- `src/modules/apps/profile-eligibility.repo.ts`

Target:

- Remove Supabase `reco.*` reads/writes from active code paths.
- Use local `recommendation.*` / `ops.*` tables.
- Profile eligibility reads local identity/preferences and writes local read models.

### Phase H: Replace Profile Access in Dependent Modules

Files:

- `src/modules/profiles/profile-access.service.ts`
- `src/modules/account-public/public-account-access.service.ts`
- `src/modules/recommendations/recommendation-data.service.ts`
- `src/modules/metadata/metadata-language.service.ts`
- `src/modules/ai/ai-insights.service.ts`
- `src/modules/ai/ai-search.service.ts`

Target:

- All profile/account access checks use local identity tables.
- Metadata language resolution reads local preferences.
- AI/search routes do not depend on Supabase profile service.

### Phase I: Retire Supabase App-Data Code

After local replacements compile and tests pass:

- Delete or quarantine Supabase data repositories/services.
- Remove Supabase app-data migrations from active workflow.
- Keep Supabase Auth docs/config only.
- Update architecture docs that currently say user data belongs in Supabase.

## Supabase Cleanup Plan

Only after code no longer reads/writes Supabase app data:

1. Confirm zero runtime references to Supabase app-data clients/RPCs.
2. Stop applying app-data migrations under `supabase/migrations`.
3. Keep Supabase project for Auth.
4. Optionally archive/drop Supabase app schemas/tables:
   - public app-data tables
   - `private` schema app tables
   - `reco` schema
   - app-data RPCs
   - app-data RLS policies
5. Keep Auth settings, providers, email templates, redirect URLs, JWT settings.

## Verification Plan

### Static Checks

Run:

```bash
npm run typecheck
npm run build
npm test
npm run contract:check
```

No package-level lint script currently exists.

### Code Search Gates

Before considering the project aligned, searches should show no app-data usage of:

- `createSupabaseUserClient`
- `getSupabaseServiceRoleClient` outside auth/admin-auth-only code
- `.from('accounts')` through Supabase
- `.from('profiles')` through Supabase
- `.from('watch_events')` through Supabase
- `.rpc('bootstrap_account')`
- `.rpc('record_playback_state')`
- `.rpc('replace_provider_import_history')`
- `.rpc('service_create_run')`
- `.rpc('service_update_run')`
- `.schema('reco')` through Supabase

### Runtime Tests

Test these flows against local Postgres:

1. Login with Supabase JWT creates/loads local account.
2. Create/list/update/delete profiles.
3. Read/write account preferences.
4. Read/write profile preferences.
5. Create/list/revoke/authenticate PAT.
6. Add/remove watchlist item.
7. Add/remove rating.
8. Record playback progress.
9. Mark watched/unwatched.
10. List continue watching.
11. List watch history.
12. Provider import writes local facts idempotently.
13. Recommendation profile signal generation reads local user state.
14. Calendar/episodic follow reads local user state and metadata.
15. Admin run/batch APIs read local recommendation tables.

## Risks and Mitigations

### Risk: Recreating Supabase RPC Logic Incorrectly

Mitigation:

- Treat current Supabase RPCs as behavior references.
- Port behavior into TypeScript services plus SQL transactions.
- Add tests around watch state transitions and provider imports.

### Risk: Metadata/User Coupling Creeps Back In

Mitigation:

- Do not FK `user_state.media_key` to metadata cache tables.
- Enforce naming/schema boundaries.
- Keep enrichment at service/read-model layer.

### Risk: Read APIs Become Slow

Mitigation:

- Add targeted indexes first.
- Add read-model tables for repeated expensive API shapes.
- Add Redis only for measured hot paths.

### Risk: Authorization Regression After Removing RLS

Mitigation:

- Centralize account/profile access checks.
- Add tests for cross-account access denial.
- Use DB roles/schema permissions as defense-in-depth.

### Risk: Too Much Big-Bang Refactor

Mitigation:

- Implement in vertical slices:
  1. Auth bootstrap + profiles.
  2. Preferences/PATs.
  3. Watch state.
  4. Provider imports.
  5. Recommendations/admin.
  6. Cleanup.

## Acceptance Criteria

- Supabase is used only for Auth/JWT verification and optional Auth Admin operations.
- All product data reads/writes use local Postgres.
- User data tables and metadata cache tables are in separate schemas/bounded contexts.
- API authorization is enforced locally.
- Watch/provider/recommendation flows no longer call Supabase RPCs.
- Typecheck, build, tests, and contract checks pass.
- Documentation reflects Supabase Auth-only architecture.
