# Supabase Layer Removal Spec

## Goal

Remove the remaining Supabase app-data layer deeply, not cosmetically. After this work, Supabase is only the external identity provider and JWT issuer. All product data, service data, recommendation data, watch state, metadata cache, admin operations, and provider/import data use server-owned Postgres through local repositories/services.

This spec is the implementation base for the removal work. It identifies the exact layers to delete, rename, replace, and guard against reintroduction.

## Current State Summary

The codebase has already moved most runtime data access away from Supabase, but still contains Supabase-shaped code and names from an older two-layer architecture.

Runtime Supabase usage that should remain:

- JWT/JWKS verification in `src/lib/jwks.ts`.
- Supabase Auth Admin calls in `src/modules/auth/external-auth-admin.service.ts` where needed for auth-user deletion.
- Auth provider configuration in `src/config/env.ts`, eventually renamed to auth-oriented names.

Runtime Supabase app-data usage that should be removed:

- `@supabase/supabase-js` as an app-data client dependency.
- `src/lib/supabase.ts` client factories.
- Supabase recommendation repository implementations.
- Supabase-named watch/admin/read/enrichment services and mappers.
- Supabase app-data RPC references, schema references, and RLS assumptions.
- Supabase-named tests and fixtures unrelated to Auth.
- Documentation and guard rules that describe Supabase as an app-data home.

## Non-Goals

- Do not remove Supabase Auth as the identity provider in this project.
- Do not change auth semantics unless required by the removal.
- Do not perform production data cleanup/drop operations until code has no app-data Supabase references.
- Do not replace Supabase-shaped classes with same-behavior wrappers that keep the old boundary alive.
- Do not preserve names like `SupabaseWatchReadRow` just because they are convenient.

## Architecture Principles

1. Supabase is an auth boundary only.
2. Local Postgres is the source of truth for all application data.
3. Local services should be named by business capability, not historical storage provider.
4. Repositories/services should depend on `DbClient`/`pg` query interfaces, not Supabase clients.
5. No product-data code should import `@supabase/supabase-js`.
6. No product-data code should call Supabase `.rpc()`, `.from()`, `.schema()`, or RLS-backed APIs.
7. Authorization lives in API/service/database-role boundaries, not Supabase RLS.
8. Deep removal includes package dependencies, dead classes, tests, docs, env names, guards, and migration workflow.

## Target Boundary

### Supabase Auth Boundary Kept

Keep only the auth provider integration:

- Remote JWKS URL derived from auth issuer.
- JWT issuer/audience validation.
- Publishable/auth key only if needed for Auth `/user` fallback.
- Auth Admin API key only if needed for auth-user admin actions.

Target names should be auth-oriented:

- `AUTH_BASE_URL` or `AUTH_ISSUER_URL` instead of app-data `SUPABASE_URL` in internal code.
- `AUTH_PUBLISHABLE_KEY` instead of `supabasePublishableKey` in internal code.
- `AUTH_ADMIN_API_KEY` instead of `supabaseAdminApiKey` in internal code.

Compatibility with existing `SUPABASE_*` env vars can remain temporarily as deprecated aliases, but application code should consume auth-named config fields.

### Local App-Data Boundary Kept

All app-data modules should use local Postgres schemas/tables through local services:

- Identity/account/profile/preferences/PATs.
- Watch state, watch history, ratings, watchlist, playback progress.
- Provider connections/import batches/imported facts.
- Metadata cache and media-card enrichment.
- Recommendation runs/batches/profile signals.
- Admin/service app registry, keys, grants, audit, bulk jobs.

## Removal Inventory

### 1. Supabase JS Client Layer

Current files:

- `src/lib/supabase.ts`
- `package.json` dependency `@supabase/supabase-js`
- `package-lock.json` transitive dependency tree

Current symbols:

- `getSupabaseServiceRoleClient()`
- `createSupabaseUserClient(accessToken)`
- `SupabaseClient` imports in app-data repos

Required action:

- Delete `src/lib/supabase.ts` after all imports are gone.
- Remove `@supabase/supabase-js` from dependencies.
- Ensure Auth code uses `fetch`/`jose`/local config and does not need the Supabase JS SDK.
- Add a retired-module guard preventing imports from `src/lib/supabase` and `@supabase/supabase-js` in `src` except if a future explicit Auth-only adapter is introduced.

Acceptance gate:

```bash
rg "@supabase/supabase-js|src/lib/supabase|getSupabaseServiceRoleClient|createSupabaseUserClient" src package.json
```

Expected result: no runtime app-data matches.

### 2. Recommendation Supabase Repositories

Current files:

- `src/modules/apps/recommendation-run.repo.ts`
- `src/modules/apps/recommendation-batch.repo.ts`

Current dead/stale classes:

- `SupabaseRecommendationRunRepo`
- `SupabaseRecommendationBatchRepo`

Current Supabase calls:

- `.rpc('service_create_run')`
- `.rpc('service_update_run')`
- `.rpc('service_create_batch')`
- `.rpc('service_update_batch')`
- `.schema('reco').from('runs')`
- `.schema('reco').from('batches')`

Current runtime wiring:

- `src/http/app.ts` already uses `SqlRecommendationRunRepo` and `SqlRecommendationBatchRepo`.

Required action:

- Remove `SupabaseRecommendationRunRepo` and `SupabaseRecommendationBatchRepo` classes entirely.
- Remove `SupabaseClient` imports from both repo files.
- Keep or rename SQL repos only if the interface still benefits from explicit `Sql*` naming.
- Confirm no conditional runtime path can select Supabase repos.
- Add tests or compile gates ensuring app wiring uses only local repositories.

Acceptance gate:

```bash
rg "SupabaseRecommendation|service_create_run|service_update_run|service_create_batch|service_update_batch|schema\('reco'\)|from\('runs'\)|from\('batches'\)" src
```

Expected result: no matches outside archived docs/specs.

### 3. Watch Read Mapper/Helper Layer

Current files:

- `src/modules/integrations/supabase-watch-read.mapper.ts`
- `src/modules/integrations/supabase-watch-read-helpers.ts`
- `src/modules/integrations/supabase-watch-read.mapper.test.ts`

Current symbols:

- `SupabaseWatchReadRow`
- `mapSupabaseContinueWatchingRow`
- `mapSupabaseListItemRow`
- `mapSupabaseRatingRow`
- `mapSupabaseHistoryRow`
- `mapSupabaseWatchStateRow`
- `pageFromRows` imported from a Supabase-named helper file

Actual behavior:

- These are generic SQL-row mappers and pagination helpers.
- They do not call Supabase.
- They map rows from local `user_state.*` tables.

Required action:

- Rename file to a storage-neutral name such as `watch-read.mapper.ts`.
- Rename helper file to `watch-read-pagination.ts` or colocate pagination under `src/modules/watch`.
- Rename type to `WatchReadRow` or narrower row types per query.
- Rename mapper functions:
  - `mapContinueWatchingRow`
  - `mapListItemRow`
  - `mapRatingRow`
  - `mapHistoryRow`
  - `mapWatchStateRow`
- Update all imports in local watch/admin/read services and tests.
- Rename test file to match the new mapper name.

Acceptance gate:

```bash
rg "SupabaseWatchReadRow|mapSupabase|supabase-watch-read" src
```

Expected result: no matches.

### 4. Admin Watch Read Service

Current file:

- `src/modules/integrations/supabase-admin-watch-read.service.ts`

Current class:

- `SupabaseAdminWatchReadService`

Actual behavior:

- Uses local DB queries against `user_state.playback_progress`, `user_state.profile_list_items`, `user_state.profile_ratings`, and `user_state.watch_events`.
- Does not use Supabase client/network APIs.
- Used by admin routes and recommendation profile-signal hydration.

Current callers:

- `src/http/routes/admin-api.ts`
- `src/modules/recommendations/profile-input-signal.facade.ts`

Required action:

- Rename file to `admin-watch-read.service.ts` or `profile-watch-read.service.ts`.
- Rename class to `AdminWatchReadService` or `ProfileWatchReadService`.
- Rename local variables such as `supabaseAdminWatchReadService` to `watchReadService` or `adminWatchReadService`.
- Update dependency type in `ProfileInputSignalFacade`.
- Fix implementation to use the passed `client` consistently instead of global `db.query` where a transaction/client is supplied.
- Keep profile-access enforcement local through `ProfileAccessService`.

Acceptance gate:

```bash
rg "SupabaseAdminWatchReadService|supabaseAdminWatchReadService|supabase-admin-watch-read" src
```

Expected result: no matches.

### 5. Local User Watch Service Imports

Current file:

- `src/modules/integrations/local-user-watch.service.ts`

Current issue:

- The service is correctly local, but imports Supabase-named mappers/helpers.

Required action:

- Update imports to storage-neutral mapper/helper names from section 3.
- Ensure method names and local variable names do not refer to Supabase.
- Keep local SQL behavior unchanged unless tests expose bugs.

Acceptance gate:

```bash
rg "supabase-watch-read|mapSupabase|SupabaseWatchReadRow" src/modules/integrations/local-user-watch.service.ts
```

Expected result: no matches.

### 6. Watch Enrichment Service

Current files:

- `src/modules/watch/watch-supabase-enrichment.service.ts`
- `src/modules/watch/watch-supabase-enrichment.service.test.ts`

Current class:

- `WatchSupabaseEnrichmentService`

Actual behavior:

- Uses local media-card cache and refresh services.
- Does not use Supabase client/network APIs.
- Log message still says `watch supabase metadata cache misses`.

Current callers/tests:

- `src/http/routes/watch.ts`
- `src/http/routes/watch.test.ts`
- `src/http/routes/admin-api.ts`

Required action:

- Rename file to `watch-metadata-enrichment.service.ts` or `watch-card-enrichment.service.ts`.
- Rename class to `WatchMetadataEnrichmentService` or `WatchCardEnrichmentService`.
- Rename variables such as `watchSupabaseEnrichmentService`.
- Rename tests and fixtures that use `supabase.test` URLs/titles unless they are intentionally testing auth provider URLs.
- Change log message to storage-neutral wording.

Acceptance gate:

```bash
rg "WatchSupabaseEnrichmentService|watchSupabaseEnrichmentService|watch-supabase-enrichment|watch supabase metadata|supabase.test" src
```

Expected result: no matches except deliberate docs/spec examples.

### 7. Misnamed Provider History Test

Current file:

- `src/modules/integrations/supabase-provider-history-writer.test.ts`

Current issue:

- The source `supabase-provider-history-writer.ts` is gone.
- The test verifies `LocalProviderHistoryWriter`.

Required action:

- Rename test file to `local-provider-history-writer.test.ts`.
- Ensure no imports or test names mention Supabase.
- Confirm `LocalProviderHistoryWriter` remains the local transactional provider import writer.

Acceptance gate:

```bash
rg "supabase-provider-history-writer|SupabaseProviderHistory|replace_provider_import_history" src
```

Expected result: no matches.

### 8. Env Config Rename

Current file:

- `src/config/env.ts`

Current internal fields:

- `supabaseUrl`
- `supabasePublishableKey`
- `supabaseSecretKey`
- `supabaseAdminApiKey`
- `supabaseServiceRoleKey`
- `authJwksUrl`
- `authJwtIssuer`
- `authAdminUrl`

Required action:

- Introduce auth-named internal fields:
  - `authBaseUrl`
  - `authJwksUrl`
  - `authJwtIssuer`
  - `authPublishableKey`
  - `authAdminApiKey`
- Make existing `SUPABASE_*` env vars deprecated aliases only if needed for deployment compatibility.
- Prefer new env vars in examples/docs:
  - `AUTH_BASE_URL`
  - `AUTH_PUBLISHABLE_KEY`
  - `AUTH_ADMIN_API_KEY`
- Remove `supabaseServiceRoleKey` from app code unless a compatibility shim is temporarily required.
- Update test env stubs to auth names where tests need auth config.

Acceptance gate:

```bash
rg "env\.supabase|supabaseUrl|supabasePublishableKey|supabaseAdminApiKey|supabaseServiceRoleKey|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY" src
```

Expected result: no app-data matches. Transitional alias parsing in `env.ts` is acceptable only if clearly marked deprecated.

### 9. Auth Admin/JWKS Naming Cleanup

Current files:

- `src/lib/jwks.ts`
- `src/modules/auth/external-auth-admin.service.ts`

Required action:

- Keep behavior.
- Replace references to `env.supabasePublishableKey` with `env.authPublishableKey`.
- Replace references to `env.supabaseAdminApiKey` with `env.authAdminApiKey`.
- Keep errors/messages auth-oriented, not Supabase data-layer oriented.
- Confirm no Supabase SDK is needed.

Acceptance gate:

```bash
rg "supabasePublishableKey|supabaseAdminApiKey|SUPABASE_SECRET_KEY|SUPABASE_PUBLISHABLE_KEY" src/lib src/modules/auth
```

Expected result: no matches except deprecated alias handling in config tests if temporarily retained.

### 10. Retired Guard Updates

Current file:

- `scripts/guard-retired-modules.ts`

Current issue:

- One guard still says local server watch-state/projection modules were retired after moving watch state to Supabase.
- This is now directionally wrong.

Required action:

- Update old guard language so it does not encode Supabase as the target architecture.
- Add new guard rules for deleted Supabase data-layer modules/classes/imports.
- Guard against reintroducing:
  - `@supabase/supabase-js`
  - `src/lib/supabase`
  - `SupabaseRecommendation*Repo`
  - `SupabaseAdminWatchReadService`
  - `WatchSupabaseEnrichmentService`
  - `SupabaseWatchReadRow`
  - `mapSupabase*`
  - `supabase-watch-read*`
  - Supabase app-data RPC names
  - `.schema('reco')` through Supabase client usage

Acceptance gate:

```bash
npm run guard:retired-modules
```

Expected result: OK after removal.

### 11. Documentation Cleanup

Files to review/update:

- `README.md`
- `DEPLOY.md`
- `AGENT.md`
- `architecture.md`
- `docs/README.md`
- `docs/api/README.md`
- `supabase/README.md`
- `.env.example`
- `.env.production.example`

Required action:

- Update active docs to say Supabase is Auth-only.
- Mark old Supabase app-data architecture docs as archived/historical or remove them from active guidance.
- Replace deployment env docs with auth-named variables, with temporary `SUPABASE_*` alias notes only if still supported.
- Ensure no doc tells future agents/developers to store app data in Supabase or rely on Supabase RLS/RPC for app data.

Acceptance gate:

```bash
rg "Supabase|supabase|RLS|service role|PostgREST|RPC" README.md DEPLOY.md AGENT.md architecture.md docs .env.example .env.production.example supabase/README.md
```

Expected result: only Auth-only references, historical docs clearly marked historical, or migration-file explanations.

### 12. Supabase Migration Workflow

Current directory:

- `supabase/migrations/`

Required action:

- Stop treating Supabase migrations as active app-data migrations.
- Keep historical migrations only if they are needed for audit or old environment teardown.
- Ensure active local DB migrations live in the project migration system used by `npm run migrate`.
- Do not apply new app-data DDL through Supabase migration workflow.
- After code cleanup, decide whether to archive `supabase/migrations` or keep only Auth-related operational notes.

Acceptance gate:

- New product schema changes are added only to local migration workflow.
- No application setup docs instruct running Supabase app-data migrations.

## Implementation Order

### Phase 0: Freeze and Baseline

1. Run current searches and record all Supabase app-data matches.
2. Run typecheck/test baseline to distinguish existing failures from removal regressions.
3. Do not start deleting until the active call graph confirms local replacements exist.

Commands:

```bash
rg "Supabase|supabase|@supabase/supabase-js|\.rpc\(|\.schema\(" src package.json README.md DEPLOY.md docs AGENT.md architecture.md .env.example .env.production.example
npm run typecheck
npm test
```

### Phase 1: Delete Dead Supabase Recommendation Implementations

1. Remove Supabase classes from recommendation run/batch repos.
2. Remove `SupabaseClient` imports.
3. Confirm `src/http/app.ts` wires only SQL repos.
4. Run typecheck and relevant recommendation tests.

### Phase 2: Rename Watch Row Mapping Layer

1. Rename mapper/helper files.
2. Rename types/functions away from Supabase.
3. Update local watch service and admin watch read service imports.
4. Rename mapper tests.
5. Run watch/integration tests.

### Phase 3: Rename Local Watch Read/Enrichment Services

1. Rename `SupabaseAdminWatchReadService` to a local/admin watch read name.
2. Rename `WatchSupabaseEnrichmentService` to a metadata/card enrichment name.
3. Update route variables and tests.
4. Fix misleading log messages and fixtures.
5. Run admin/watch/recommendation signal tests.

### Phase 4: Remove Supabase Client Factory and Package

1. Confirm no app code imports `src/lib/supabase.ts`.
2. Delete `src/lib/supabase.ts`.
3. Remove `@supabase/supabase-js` from `package.json` and lockfile through package manager.
4. Run typecheck/build/tests.

### Phase 5: Rename Auth Config Internals

1. Add auth-named config fields.
2. Update JWKS/Auth Admin code to use auth names.
3. Keep deprecated `SUPABASE_*` env aliases only if deployments still need them.
4. Update env examples and docs.
5. Update test stubs.

### Phase 6: Guard and Docs

1. Update `scripts/guard-retired-modules.ts`.
2. Update active docs and mark historical docs clearly.
3. Add search gates to guard script where practical.
4. Run full verification.

### Phase 7: Production Cleanup Planning

Only after all code gates pass:

1. Confirm production runtime has no Supabase app-data reads/writes.
2. Stop applying Supabase app-data migrations.
3. Inventory old Supabase app schemas/RPCs/RLS policies.
4. Archive/drop old app-data objects in a separate operational plan.
5. Keep Supabase Auth configuration intact.

## Code Search Gates

The removal is not complete while any active runtime/test code contains these names, except where explicitly allowed for Auth-only compatibility aliases:

```text
@supabase/supabase-js
src/lib/supabase
getSupabaseServiceRoleClient
createSupabaseUserClient
SupabaseClient
SupabaseRecommendationRunRepo
SupabaseRecommendationBatchRepo
SupabaseAdminWatchReadService
WatchSupabaseEnrichmentService
SupabaseWatchReadRow
mapSupabase
supabase-watch-read
supabase-admin-watch-read
watch-supabase-enrichment
supabase-provider-history-writer
service_create_run
service_update_run
service_create_batch
service_update_batch
bootstrap_account
record_playback_state
replace_provider_import_history
schema('reco')
PostgREST
Supabase RLS
```

Allowed remaining Supabase references after implementation:

- Auth-only docs describing the external identity provider.
- Deprecated env alias parsing in `env.ts`, if still needed.
- Historical archived docs clearly marked as not current architecture.
- Old SQL migration files if retained only for historical/teardown context.

## Verification Plan

Run after each phase where practical:

```bash
npm run typecheck
npm run build
npm test
npm run guard:retired-modules
```

Run before final acceptance:

```bash
npm run contract:check
```

No package-level lint script exists currently.

## Runtime Flow Tests

Manually or through integration tests verify:

1. Supabase JWT verifies through JWKS.
2. Auth `/user` fallback still works if configured.
3. Auth admin user deletion still works if configured.
4. Account bootstrap/load uses local identity tables.
5. Profile CRUD/access checks use local identity tables.
6. PAT auth uses local private tables.
7. Watchlist writes and reads use local `user_state.profile_list_items`.
8. Ratings writes and reads use local `user_state.profile_ratings`.
9. Playback writes and continue-watching reads use local `user_state.playback_progress`.
10. History reads use local `user_state.watch_events`.
11. Provider imports write local batches/events/list/rating/progress rows idempotently.
12. Recommendation signal hydration reads local watch state.
13. Recommendation run/batch APIs read/write local recommendation/app tables.
14. Admin watch endpoints read local watch state and enrich via local metadata cache.
15. Metadata enrichment refreshes local cache and does not call Supabase.

## Acceptance Criteria

- Supabase remains only as Auth/JWT/Auth-Admin provider.
- `@supabase/supabase-js` is not a runtime dependency.
- No product-data code imports Supabase clients or uses Supabase RPC/PostgREST/RLS.
- All Supabase-named app-data classes, functions, files, variables, and tests are deleted or renamed.
- Recommendation repos have only local SQL implementations.
- Watch read, admin read, local watch service, and enrichment service names reflect local DB/cache behavior.
- Env/config internals are auth-named, with any `SUPABASE_*` compatibility clearly deprecated.
- Guard script prevents reintroducing the removed Supabase app-data layer.
- Active docs describe Supabase Auth-only architecture.
- Typecheck, build, tests, retired-module guard, and contract checks pass.
