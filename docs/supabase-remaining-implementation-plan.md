# Supabase Remaining Implementation Plan

Status: implementation-level follow-up plan for the remaining Supabase/Fastify/RLS migration work.

Canonical architecture reference: `docs/supabase-fastify-rls-target-architecture-plan.md`.

This file is intentionally optimized for LLM implementation agents. It uses exact file paths, function names, expected code edits, test targets, migration names, and acceptance criteria.

## 0. Current baseline before starting this plan

These are assumed already done in the working tree:

- `src/http/routes/watch.ts`
  - All watch routes use `app.requireUserSessionActor(request)`.
  - `mark-watched` and `unmark-watched` no longer use `WatchEventIngestService` as the public source-of-truth path.
  - `mark-watched` calls `SupabaseUserWatchService.markWatched(...)`.
  - `unmark-watched` calls `SupabaseUserWatchService.unmarkWatched(...)`.
  - User-scoped Supabase access token is required through `requireSupabaseAccessToken(actor)`.
- `src/modules/integrations/supabase-user-watch.service.ts`
  - Mutations throw `HttpError(502, 'Supabase watch write failed.')` on Supabase RPC errors.
  - `markWatched` and `unmarkWatched` call RPC `set_profile_watched_state`.
- `src/modules/integrations/supabase-watch-writer.ts`
  - Removed as dormant unsafe service-role/direct-table writer.
- `src/modules/users/account-deletion.service.ts`
  - Uses injectable transaction runner instead of hard-coded `withTransaction`.
- `src/test-helpers.ts`
  - `NOOP_TRANSACTION` provides a fake client with `query(...)`.
- `supabase/migrations/20260511235900_add_set_profile_watched_state_rpc.sql`
  - Adds `public.set_profile_watched_state(...)` RPC.
- `supabase/tests/rpc_set_profile_watched_state.test.sql`
  - Placeholder SQL test skeleton exists.
- Verified focused checks:
  - `node --import tsx --test "src/http/routes/watch.test.ts"`
  - `node --import tsx --test "src/modules/users/account-deletion.service.test.ts"`
  - `npm run typecheck`
  - `npm run build`

Do not undo any of the above.

## 1. Non-negotiable constraints for all remaining work

1. Public user data path remains `Client -> Fastify -> Supabase user JWT -> RLS/RPC`.
2. Public user routes must never swap the user JWT for `service_role`.
3. `service_role` is allowed only in trusted backend paths:
   - provider import jobs,
   - backfills,
   - admin repair jobs,
   - Supabase Auth admin APIs,
   - recommendation/internal readers where Fastify has already authorized the account/profile.
4. No direct browser/mobile Supabase data access by default.
5. Every Supabase SQL/RLS/RPC change goes under `supabase/migrations/` and is tested under `supabase/tests/` or with a documented MCP/dev-branch verification.
6. Do not rewrite historical migrations. Add forward migrations.
7. Do not silently accept failed public Supabase writes.
8. PATs do not have Supabase user JWTs. They must be rejected on user-RLS-backed routes unless a separate trusted relay design is implemented.
9. Recommendation engine must not read Supabase directly. It must go through Fastify/internal service code.
10. Retire local watch source-of-truth code only after provider import, recommendation reads, side effects, and tests no longer depend on it.

## 2. Live Supabase state to account for

MCP inspection showed these live migrations already exist remotely:

- `20260510154106 create_user_infra_foundation`
- `20260510154236 secure_user_infra_rls`
- `20260510154309 bootstrap_user_infra_accounts`
- `20260510154338 harden_bootstrap_current_account_rpc`
- `20260510154500 add_profiles_created_by_account_index`
- `20260510155757 create_watch_history_provider_imports`
- `20260510185111 lean_provider_import_history`
- `20260510185212 grant_lean_watch_history_columns`
- `20260510185309 rewrite_watch_history_compact`
- `20260510192129 create_media_card_snapshots_and_history_view`
- `20260511135021 create_user_media_provider_state`
- `20260511141532 harden_user_media_state_user_rpcs`
- `20260511142920 create_watch_read_models`
- `20260511142935 create_watch_state_read_rpc`

Live public tables with RLS enabled:

- `accounts`
- `profiles`
- `profile_members`
- `account_preferences`
- `profile_preferences`
- `account_entitlements`
- `provider_connections`
- `provider_oauth_states`
- `provider_import_batches`
- `watch_history`
- `media_card_snapshots`
- `profile_media_state`
- `continue_watching_items`
- `profile_list_items`
- `profile_ratings`

Known security advisor warnings to resolve or explicitly document:

- `function_search_path_mutable`
  - `public.list_profile_list_items_page`
  - `public.list_continue_watching_page`
  - `public.list_profile_ratings_page`
  - `public.list_watch_history_page`
- `anon_security_definer_function_executable`
  - `public.get_profile_watch_state(...)`
  - `public.list_continue_watching_page(...)`
  - `public.list_profile_list_items_page(...)`
  - `public.list_profile_ratings_page(...)`
  - `public.list_watch_history_page(...)`
  - `public.record_playback_state(...)`
  - `public.rls_auto_enable()`
- `authenticated_security_definer_function_executable`
  - user RPCs are intentionally callable by authenticated users if they validate `auth.uid()` and profile membership.
  - `public.rls_auto_enable()` should not be callable by authenticated users.
- `auth_leaked_password_protection`
  - product/security setting outside code migration; enable in Supabase Auth settings if desired.

Known performance advisor items to fix with indexes:

- `continue_watching_items_last_actor_account_id_fkey`
- `profile_list_items_last_actor_account_id_fkey`
- `profile_media_state_last_actor_account_id_fkey`
- `profile_ratings_last_actor_account_id_fkey`
- `provider_oauth_states_account_id_fkey`
- `provider_oauth_states_profile_id_fkey`

Do not remove `unused_index` advisor items during this migration. They are likely young/low-traffic indexes.

## 3. Workstream A: provider import alignment

### 3.1 Goal

Provider imports must sync all provider interaction facts to Supabase user-interaction state, not only history.

Current active path:

- `src/modules/integrations/provider-import.service.ts`
  - `runQueuedImport(...)` builds `importedPayload`.
  - `syncProviderHistoryToSupabase(...)` passes only `importedPayload.importedHistoryEntries`.
- `src/modules/integrations/supabase-provider-history-writer.ts`
  - `replaceImportedHistory(...)` calls only RPC `replace_provider_import_history`.

Target path:

- Provider import worker uses service-role only because this is a trusted backend job.
- One active writer owns all provider-import Supabase writes.
- The writer syncs:
  - watched history,
  - watchlist/favorites list state,
  - ratings,
  - playback/continue-watching snapshots if present.
- Provider import failure behavior is explicit:
  - missing Supabase service role can be warning/skipped in local/dev,
  - RPC errors must become job warning or failed job according to configured strictness,
  - never pretend successful Supabase sync if RPC failed.

### 3.2 File-level edits

#### 3.2.1 Rename or expand active writer

Preferred: rename active class/file for accuracy.

Option 1, minimal diff:

- Keep file: `src/modules/integrations/supabase-provider-history-writer.ts`
- Rename class to `SupabaseProviderImportWriter` only if all imports/tests are updated.
- If avoiding rename churn, keep class name but add methods. Document that it now handles provider interactions, not only history.

Option 2, clearer:

- Create `src/modules/integrations/supabase-provider-import-writer.ts`.
- Move existing logic from `supabase-provider-history-writer.ts`.
- Delete `supabase-provider-history-writer.ts` after imports/tests update.

Recommended implementation: Option 2 if time permits, otherwise Option 1.

#### 3.2.2 Add writer input types

Add types near the top of the writer file:

```ts
type ImportedProviderHistoryEntry = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  watchedAt: string;
  sourceKind: 'provider_import';
};

type ImportedProviderListItem = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  addedAt: string;
};

type ImportedProviderRating = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  rating: number;
  ratedAt: string;
};

type ImportedProviderPlaybackState = {
  mediaKey: string;
  titleMediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressBps: number | null;
  occurredAt: string;
  completed: boolean;
};

export type SupabaseProviderImportSyncResult = {
  historyInserted: number;
  watchlistInserted: number;
  ratingsInserted: number;
  playbackInserted: number;
  skipped: boolean;
  warnings: string[];
};
```

Use existing repo style: no comments in code.

#### 3.2.3 Add one orchestration method

Add method:

```ts
async replaceImportedInteractions(params: {
  appUser: AppUser;
  job: ProviderImportJobRecord;
  profile: ProfileRecord;
  providerSession: ProviderSessionRecord;
  historyGeneration: number;
  importedAt: string;
  historyEntries: ImportedProviderHistoryEntry[];
  watchlistItems: ImportedProviderListItem[];
  ratings: ImportedProviderRating[];
  playbackStates: ImportedProviderPlaybackState[];
}): Promise<SupabaseProviderImportSyncResult>
```

Implementation details:

1. If `this.supabaseClient` is null:
   - log warning,
   - return `{ historyInserted: 0, watchlistInserted: 0, ratingsInserted: 0, playbackInserted: 0, skipped: true, warnings: ['supabase service role client not configured'] }`.
2. Resolve common context once:
   - `accountId = params.appUser.authSubject`
   - `legacyAppUserId = params.appUser.id`
   - `profileId = params.profile.id`
   - `profileGroupId = params.profile.profileGroupId`
   - `provider = params.job.provider`
3. Call existing RPC `replace_provider_import_history` with same args as current `replaceImportedHistory`.
4. Call existing live RPC `replace_provider_import_list_items`:
   - args expected from removed dormant writer:
     - `p_account_id`
     - `p_profile_id`
     - `p_provider`
     - `p_list_kind`
     - `p_items`
   - use `p_list_kind: 'watchlist'`.
   - map items to `{ media_key, media_type, added_at }`.
5. Call existing live RPC `replace_provider_import_ratings`:
   - args expected from removed dormant writer:
     - `p_account_id`
     - `p_profile_id`
     - `p_provider`
     - `p_ratings`
   - map ratings to `{ media_key, media_type, rating, rated_at }`.
6. For playback states, add new Supabase RPC before wiring production call:
   - `replace_provider_import_playback_states`
   - service-role only
   - args:
     - `p_account_id uuid`
     - `p_profile_id uuid`
     - `p_provider text`
     - `p_states jsonb`
   - map states to:
     - `media_key`
     - `title_media_key`
     - `media_type`
     - `position_seconds`
     - `duration_seconds`
     - `progress_bps`
     - `occurred_at`
     - `completed`
7. Failure behavior:
   - Do not throw on missing client.
   - For RPC error, collect warning and continue to later RPCs only if the failure is isolated.
   - Return `skipped: true` only when no Supabase operation ran.
   - Return `warnings` if one or more RPCs failed.
   - `ProviderImportService` decides whether warnings mark job `succeeded_with_warnings`.

#### 3.2.4 Convert `importedEvents` into provider lists/ratings/playback

Edit `src/modules/integrations/provider-import.service.ts`.

Current types are private in this file:

- `ImportedWatchEventDraft`
- `ProviderReplaceImportPayload`

Add helper methods inside `ProviderImportService`:

```ts
private buildSupabaseProviderImportFacts(importedPayload: ProviderReplaceImportPayload): {
  watchlistItems: ImportedProviderListItem[];
  ratings: ImportedProviderRating[];
  playbackStates: ImportedProviderPlaybackState[];
}
```

Mapping rules:

- `eventType === 'watchlist_put'`
  - emit list item:
    - `mediaKey = event.mediaKey`
    - `mediaType = event.mediaType`
    - `addedAt = event.occurredAt`
- `eventType === 'watchlist_remove'`
  - do not emit item in replace-mode.
  - Because provider import mode is `replace_import`, final provider watchlist is represented by current `watchlist_put` events.
  - If a provider later supports delta mode, add a separate deletion RPC.
- `eventType === 'rating_put'`
  - emit rating:
    - `mediaKey = event.mediaKey`
    - `mediaType = event.mediaType`
    - `rating = event.rating`
    - `ratedAt = event.occurredAt`
  - skip if rating is not finite.
- `eventType === 'rating_remove'`
  - do not emit rating in replace-mode.
- `eventType === 'playback_progress_snapshot'`
  - emit playback state:
    - `mediaKey = event.mediaKey`
    - `titleMediaKey = title identity for continue watching`
    - `positionSeconds = event.positionSeconds ?? null`
    - `durationSeconds = event.durationSeconds ?? null`
    - `progressBps = duration > 0 ? Math.round(position / duration * 10000) : null`
    - `completed = false`
    - `occurredAt = event.occurredAt`
- `eventType === 'playback_completed'`
  - emit playback state:
    - same fields,
    - `completed = true`
- `eventType === 'mark_watched'`
  - already represented by `importedHistoryEntries`; do not duplicate playback unless product wants completed state projection.

Need title media key derivation:

- Use existing identity helpers where possible:
  - `inferMediaIdentity(...)`
  - `canonicalContinueWatchingMediaKey(...)`
- For episode playback, title key should be the parent/show title key if helper can infer it.
- If helper cannot derive title key safely, use `event.mediaKey` and add a warning counter in summary.

#### 3.2.5 Replace `syncProviderHistoryToSupabase`

Rename method in `ProviderImportService`:

- From: `syncProviderHistoryToSupabase(...)`
- To: `syncProviderInteractionsToSupabase(...)`

New params:

```ts
private async syncProviderInteractionsToSupabase(params: {
  job: ProviderImportJobRecord;
  providerSession: ProviderSessionRecord;
  historyGeneration: number;
  importedAt: string;
  entries: ImportedHistoryEntryDraft[];
  events: ImportedWatchEventDraft[];
}): Promise<SupabaseProviderImportSyncResult>
```

Inside:

1. Load `profile` and `appUser` exactly like current method.
2. If missing, return skipped result with warning.
3. Build facts from events.
4. Call writer `replaceImportedInteractions(...)`.
5. Return summary.

Update `runQueuedImport(...)`:

- Replace variable `supabaseHistorySummary` with `supabaseInteractionSummary`.
- Pass `events: importedPayload.importedEvents`.
- Include summary in job summary JSON.
- If `supabaseInteractionSummary.warnings.length > 0`, push those warnings into job warnings.
- Logger should include `supabaseInteractionSummary`.

### 3.3 Supabase SQL migration for provider playback

Create forward migration:

`supabase/migrations/YYYYMMDDHHMMSS_add_provider_import_playback_state_rpc.sql`

Required RPC:

```sql
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
-- implementation
$$;
```

Implementation logic:

1. Ensure caller is service role.
   - Preferred: use role/grant boundary only; revoke from anon/authenticated and grant execute to service_role.
   - If existing project has helper for service-role detection, use it.
2. Validate profile belongs to account:
   - `exists(select 1 from public.profiles where id = p_profile_id and account_id = p_account_id)` or existing helper.
3. For replace semantics:
   - Delete prior provider-import playback state for `p_profile_id` and `p_provider` from `continue_watching_items` where `source_kind = 'provider_import' and source_provider = p_provider`.
   - Upsert `profile_media_state` rows from `p_states` as provider-import source.
   - Insert/update active `continue_watching_items` for incomplete playback states.
   - Delete continue watching rows for completed states.
4. Return inserted/upserted count.
5. Grants:
   - `REVOKE EXECUTE ON FUNCTION public.replace_provider_import_playback_states(...) FROM PUBLIC, anon, authenticated;`
   - `GRANT EXECUTE ON FUNCTION public.replace_provider_import_playback_states(...) TO service_role;`

### 3.4 Tests

Add unit test file:

`src/modules/integrations/supabase-provider-import-writer.test.ts`

or if no rename:

`src/modules/integrations/supabase-provider-history-writer.test.ts`

Test fake Supabase client:

```ts
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const client = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: 1, error: null };
  },
} as never;
```

Required tests:

1. No client returns skipped result and warning.
2. History-only payload calls `replace_provider_import_history` exactly once.
3. Watchlist facts call `replace_provider_import_list_items` with `p_list_kind: 'watchlist'`.
4. Rating facts call `replace_provider_import_ratings`.
5. Playback facts call `replace_provider_import_playback_states`.
6. One RPC error adds warning and marks partial summary without throwing.

Add/extend provider service tests in:

`src/modules/integrations/provider-import.service.test.ts`

Tests:

1. `syncProviderInteractionsToSupabase` passes imported events to writer.
2. `runQueuedImport` includes `supabaseInteractionSummary` in job summary.
3. Warnings from writer result in `markSucceededWithWarnings`.

### 3.5 Verification commands

Run:

```bash
node --import tsx --test "src/modules/integrations/supabase-provider-history-writer.test.ts"
node --import tsx --test "src/modules/integrations/provider-import.service.test.ts"
npm run typecheck
npm run build
```

If writer file is renamed, use the new test path.

### 3.6 Acceptance criteria

- Provider imports sync history, watchlist, ratings, and playback snapshots to Supabase.
- Service role usage is isolated to the provider import writer.
- Public user routes still use user JWT only.
- Provider import job summary records all Supabase sync counts and warnings.
- No dormant `supabase-watch-writer.ts` returns.

## 4. Workstream B: recommendation alignment to Supabase interaction data

### 4.1 Goal

Recommendation inputs should read Supabase interaction state instead of local watch source tables, while keeping Fastify as the only backend boundary for recommendation source-data access.

Current local read path:

- `src/modules/recommendations/profile-input-signal.facade.ts`
  - Calls `RecommendationDataService` for history, ratings, watchlist, trackedSeries.
  - Calls `PersonalMediaService` for continue-watching.
- `src/modules/recommendations/recommendation-data.service.ts`
  - Uses `WatchExportService` and local DB for:
    - `getWatchHistoryForAccountService(...)`
    - `getWatchlistForAccountService(...)`
    - `getRatingsForAccountService(...)`
    - `getEpisodicFollowForAccountService(...)`
- `PersonalMediaService.listContinueWatchingProducts(...)`
  - Current local continue-watching source.

Target:

- History/watchlist/ratings/continue-watching come from Supabase for recommendation inputs.
- `trackedSeries` can remain local until Supabase has equivalent model.
- RECO still calls Fastify/internal APIs; RECO does not receive Supabase keys and does not query Supabase directly.
- Fastify validates account/profile ownership before any service-role Supabase read.

### 4.2 Add source mode config

Add env var in `src/config/env.ts`:

```ts
RECOMMENDATION_SIGNAL_SOURCE=local|supabase_shadow|supabase
```

Default: `local`.

Meaning:

- `local`: current behavior.
- `supabase_shadow`: read local as source of response, also read Supabase and log parity diagnostics.
- `supabase`: response uses Supabase for supported families.

Add parsed value:

```ts
recommendationSignalSource: 'local' | 'supabase_shadow' | 'supabase'
```

Update `.env.example` and `.env.production.example`.

### 4.3 Add trusted Supabase recommendation reader

Create:

`src/modules/recommendations/supabase-recommendation-signal-reader.ts`

Constructor dependencies:

```ts
constructor(
  private readonly supabaseClient = env.supabaseAdminApiKey ? getSupabaseServiceRoleClient() : null,
  private readonly profileAccessService = new ProfileAccessService(),
  private readonly profileRepository = new ProfileRepository(),
  private readonly watchMediaCardCacheService = new WatchMediaCardCacheService(),
  private readonly metadataCardService = new MetadataCardService(),
) {}
```

Methods:

```ts
async listHistoryForAccount(accountId: string, profileId: string, limit: number): Promise<...>
async listWatchlistForAccount(accountId: string, profileId: string, limit: number): Promise<...>
async listRatingsForAccount(accountId: string, profileId: string, limit: number): Promise<...>
async listContinueWatchingForAccount(accountId: string, profileId: string, limit: number): Promise<...>
```

Authorization rule inside every method:

1. Use local DB `ProfileAccessService.assertOwnedProfile(client, profileId, accountId)` before Supabase service-role read.
2. Never trust caller-provided profile ID without this local check.
3. After local auth, call Supabase with service role because recommendation internal jobs do not have user JWT.

Supabase read strategy options:

Option A, initial implementation:

- Service-role direct table reads through `supabase.from(...)` after local authorization.
- Limit direct reads to this one reader file.
- Tables:
  - `watch_history`
  - `profile_list_items`
  - `profile_ratings`
  - `continue_watching_items`
- Filters must include both `account_id` and `profile_id`.

Option B, stronger implementation:

- Add service-role-only RPCs:
  - `list_recommendation_watch_history(p_account_id, p_profile_id, p_limit)`
  - `list_recommendation_watchlist(p_account_id, p_profile_id, p_limit)`
  - `list_recommendation_ratings(p_account_id, p_profile_id, p_limit)`
  - `list_recommendation_continue_watching(p_account_id, p_profile_id, p_limit)`
- RPCs validate profile/account relation.
- Grant only to `service_role`.

Recommended: Option B for durable security, Option A acceptable only as a short transition with tests and TODO in this plan.

### 4.4 Hydration mapping

Supabase rows are lean interaction facts. Existing recommendation payload expects hydrated media cards.

Use existing hydration approach from `RecommendationDataService`:

- batch media keys,
- `WatchMediaCardCacheService.listRegularCards(client, mediaKeys)`,
- fallback with `fallbackRegularCard(...)` where available,
- if no media can be built, drop item rather than returning invalid media.

For each family:

- history:
  - sort by `watched_at desc`.
  - item fields:
    - `id`
    - `media`
    - `watchedAt`
    - `payload`
- watchlist:
  - filter `list_kind = 'watchlist'`.
  - sort by `added_at desc`.
  - item fields:
    - `id` can be deterministic `${profileId}:watchlist:${mediaKey}` if no Supabase id.
    - `media`
    - `addedAt`
    - `payload`
- ratings:
  - sort by `rated_at desc`.
  - item fields:
    - `id` deterministic if needed,
    - `media`,
    - `rating.value`,
    - `rating.ratedAt`,
    - `payload`
- continue-watching:
  - sort by `last_activity_at desc`.
  - use existing `ContinueWatchingProductItem` contract.

### 4.5 Modify `RecommendationDataService`

Add constructor dependency:

```ts
private readonly supabaseSignalReader = new SupabaseRecommendationSignalReader()
```

Add helper:

```ts
private shouldUseSupabaseSignals(): boolean
private shouldShadowSupabaseSignals(): boolean
```

Update service methods:

- `getWatchHistoryForAccountService(...)`
- `getWatchlistForAccountService(...)`
- `getRatingsForAccountService(...)`

Behavior:

- `local`: current code path unchanged.
- `supabase`: return Supabase reader result.
- `supabase_shadow`:
  1. run local path and Supabase path in parallel if safe.
  2. return local path.
  3. log parity diagnostics:
     - count diff,
     - first N media keys diff,
     - errors reading Supabase.
  4. never fail response due to Supabase shadow error.

For `continueWatching`, either:

- add a dependency to `ProfileInputSignalFacade` for a new Supabase continue reader, or
- move continue-watching signal generation into `RecommendationDataService` so all migrated families use one source switch.

Recommended: add method to `RecommendationDataService`:

```ts
async getContinueWatchingForAccountService(accountId: string, profileId: string, limit: number)
```

Then update `ProfileInputSignalFacade.fetchLivePayload(...)` case `continueWatching` to call recommendation data service instead of `PersonalMediaService` when source mode is `supabase` or `supabase_shadow`.

### 4.6 Restore side effects for Supabase public mutations

Before local source-of-truth removal, `WatchEventIngestService` performed side effects:

- calendar cache invalidation,
- profile input signal cache invalidation,
- metadata refresh scheduling,
- recommendation recompute outbox events.

After public routes moved to Supabase, these side effects must still happen after successful Supabase mutation.

Create:

`src/modules/watch/watch-mutation-side-effects.service.ts`

Methods:

```ts
async afterPlaybackStateChanged(params: { appUserId: string; profileId: string; mediaKey: string; reason: 'playback_progress_changed' | 'watch_history_changed' }): Promise<void>
async afterWatchHistoryChanged(params: { appUserId: string; profileId: string; mediaKey: string }): Promise<void>
async afterWatchlistChanged(params: { appUserId: string; profileId: string; mediaKey: string }): Promise<void>
async afterRatingChanged(params: { appUserId: string; profileId: string; mediaKey: string }): Promise<void>
```

Implement using existing services from `WatchEventIngestService`:

- `ProfileInputSignalCacheInvalidator`
- recommendation outbox service used by `WatchEventIngestService.applyMutation(...)`
- calendar cache invalidation helper if already exported or reusable
- metadata refresh service if current ingest path schedules it

Modify `src/http/routes/watch.ts`:

- construct `const sideEffectsService = new WatchMutationSideEffectsService();`
- after each successful Supabase write, call relevant side effect method.
- Side effects should be best-effort:
  - log warnings if side effect fails,
  - do not report Supabase mutation failure if side effect fails,
  - but add structured telemetry.

Routes and reasons:

- `POST /watch/events`
  - `playback_completed` -> history changed + playback changed
  - progress -> playback changed
- `POST /mark-watched`
  - history changed
- `POST /unmark-watched`
  - history changed
- `PUT /watchlist/:mediaKey`
  - watchlist changed
- `DELETE /watchlist/:mediaKey`
  - watchlist changed
- `PUT /rating/:mediaKey`
  - rating changed
- `DELETE /rating/:mediaKey`
  - rating changed
- `DELETE /continue-watching/:id`
  - playback/continue changed

### 4.7 Recommendation tests

Add/modify tests:

- `src/modules/recommendations/supabase-recommendation-signal-reader.test.ts`
  - local profile authorization called before Supabase query.
  - service-role client missing throws or returns configured failure.
  - table/RPC filters include both `account_id` and `profile_id`.
  - hydration uses cache and drops unhydratable rows.
- `src/modules/recommendations/recommendation-data.service.test.ts`
  - source mode `local` uses local `WatchExportService`.
  - source mode `supabase` uses Supabase reader.
  - source mode `supabase_shadow` returns local but logs diff.
- `src/modules/recommendations/profile-input-signal.facade.test.ts`
  - continue-watching uses selected source path.
- `src/http/routes/watch.test.ts`
  - after Supabase write success, side effect service called once.
  - if Supabase write fails, side effect service not called.

### 4.8 Verification commands

```bash
node --import tsx --test "src/modules/recommendations/*.test.ts"
node --import tsx --test "src/http/routes/watch.test.ts"
npm run typecheck
npm run build
```

### 4.9 Acceptance criteria

- Recommendation signal source can run in local, shadow, and Supabase modes.
- Supabase mode does not expose Supabase to RECO or clients.
- Local ownership check occurs before service-role Supabase reads.
- Public watch mutations still trigger recommendation/cache invalidation side effects.
- Shadow mode logs parity diagnostics and does not change response payload.

## 5. Workstream C: Supabase SQL/RLS/RPC hardening and tests

### 5.1 Goal

Make Supabase schema/RLS/RPC state reproducible, tested, and advisor-clean enough for the architecture.

### 5.2 Baseline strategy

The live project already has migrations not checked into this repo. Do not attempt destructive reset.

Implement this in two tracks:

Track 1: baseline capture for repo reproducibility.

1. Use Supabase CLI if available:
   - `supabase db pull`
   - or dump schema-only through a trusted connection.
2. Commit a baseline snapshot under:
   - `supabase/migrations/20260512000000_live_schema_baseline.sql`
3. Header must say:
   - this captures current live schema for new environments,
   - do not apply blindly to an already-migrated production project,
   - production should receive only forward migrations after current remote version.
4. If CLI cannot be used, reconstruct from MCP/introspection in smaller migration files and validate on a Supabase dev branch.

Track 2: forward hardening migrations.

1. Add only forward migrations for production.
2. Apply to dev branch first.
3. Run advisors after each security migration.

### 5.3 Hardening migration 1: revoke unsafe function grants and fix search paths

Create:

`supabase/migrations/YYYYMMDDHHMMSS_harden_user_watch_rpc_grants.sql`

Migration operations:

1. Fix mutable search path warnings:

```sql
ALTER FUNCTION public.list_profile_list_items_page(uuid, text, integer, timestamptz, text)
  SET search_path TO 'public', 'private';
ALTER FUNCTION public.list_continue_watching_page(uuid, integer, timestamptz, text)
  SET search_path TO 'public', 'private';
ALTER FUNCTION public.list_profile_ratings_page(uuid, integer, timestamptz, text)
  SET search_path TO 'public', 'private';
ALTER FUNCTION public.list_watch_history_page(uuid, integer, timestamptz, uuid)
  SET search_path TO 'public', 'private';
```

2. Revoke anon execute from all user SECURITY DEFINER RPCs:

```sql
REVOKE EXECUTE ON FUNCTION public.get_profile_watch_state(uuid, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_continue_watching_page(uuid, integer, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_profile_list_items_page(uuid, text, integer, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_profile_ratings_page(uuid, integer, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_watch_history_page(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_playback_state(uuid, text, text, text, integer, integer, smallint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_profile_watched_state(uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon;
```

3. Grant execute to authenticated only where Fastify user-JWT route needs it:

```sql
GRANT EXECUTE ON FUNCTION public.get_profile_watch_state(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_continue_watching_page(uuid, integer, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_profile_list_items_page(uuid, text, integer, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_profile_ratings_page(uuid, integer, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_watch_history_page(uuid, integer, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_playback_state(uuid, text, text, text, integer, integer, smallint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_watched_state(uuid, text, text, text, text, timestamptz) TO authenticated;
```

4. Lock down `rls_auto_enable`:

```sql
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
```

If `rls_auto_enable` is no longer needed, replace with drop in a separate migration only after checking dependencies.

5. Do not remove authenticated execute on user RPCs if Fastify user-JWT path depends on them.
   - Supabase advisor may continue warning about authenticated security definer functions.
   - This is acceptable only if:
     - anon is revoked,
     - functions validate `auth.uid()`,
     - functions validate profile membership/write access,
     - function `search_path` is fixed,
     - tests cover cross-profile denial.

### 5.4 Hardening migration 2: missing FK indexes

Create:

`supabase/migrations/YYYYMMDDHHMMSS_add_missing_fk_indexes.sql`

Add indexes:

```sql
CREATE INDEX IF NOT EXISTS continue_watching_items_last_actor_account_id_idx
  ON public.continue_watching_items(last_actor_account_id);

CREATE INDEX IF NOT EXISTS profile_list_items_last_actor_account_id_idx
  ON public.profile_list_items(last_actor_account_id);

CREATE INDEX IF NOT EXISTS profile_media_state_last_actor_account_id_idx
  ON public.profile_media_state(last_actor_account_id);

CREATE INDEX IF NOT EXISTS profile_ratings_last_actor_account_id_idx
  ON public.profile_ratings(last_actor_account_id);

CREATE INDEX IF NOT EXISTS provider_oauth_states_account_id_idx
  ON public.provider_oauth_states(account_id);

CREATE INDEX IF NOT EXISTS provider_oauth_states_profile_id_idx
  ON public.provider_oauth_states(profile_id);
```

Do not remove unused indexes in this workstream.

### 5.5 Hardening migration 3: provider playback RPC

Covered in Workstream A section 3.3.

### 5.6 Supabase tests

Use SQL files under `supabase/tests/`.

Recommended structure:

```text
supabase/tests/
  grants_user_watch_rpc.sql
  rls_profile_membership.sql
  rpc_set_profile_watched_state.sql
  rpc_provider_imports_service_role.sql
  rpc_recommendation_service_role.sql
```

If pgTAP is not installed, use plain SQL `DO $$` blocks with `RAISE EXCEPTION` assertions.

Test required cases:

#### grants_user_watch_rpc.sql

- anon cannot execute:
  - `get_profile_watch_state`
  - list RPCs
  - `record_playback_state`
  - `set_profile_watched_state`
- authenticated can execute user RPCs but only with valid `auth.uid()` and profile membership.
- authenticated cannot execute service-role provider RPCs.
- anon/authenticated cannot execute `rls_auto_enable()`.

#### rls_profile_membership.sql

- User A can select only own account/profile rows.
- User A cannot select User B profile rows.
- User A cannot write User B profile state.
- Profile member role rules match product expectation.

#### rpc_set_profile_watched_state.sql

- no auth -> exception.
- invalid media type -> exception.
- invalid watch state -> exception.
- own profile mark watched:
  - upserts `profile_media_state.watch_state = 'watched'`.
  - sets `playback_status = 'completed'`.
  - inserts `watch_history`.
  - deletes matching `continue_watching_items`.
- own profile unmark watched:
  - sets `watch_state = 'unwatched'`.
  - clears completed/watched timestamps.
  - deletes local `watch_history` rows for media.
  - deletes matching `continue_watching_items`.
- other profile -> denied.

#### rpc_provider_imports_service_role.sql

- service_role can execute:
  - `replace_provider_import_history`
  - `replace_provider_import_list_items`
  - `replace_provider_import_ratings`
  - `replace_provider_import_playback_states`
- authenticated cannot execute those RPCs.
- replace semantics remove stale provider-import rows for same provider/profile without deleting local rows.

#### rpc_recommendation_service_role.sql

Only needed if adding recommendation service-role RPCs.

- service_role can read target profile after passing account/profile args.
- authenticated/anon cannot execute.
- wrong account/profile pair returns no rows or denied.

### 5.7 Dev branch MCP verification

Preferred flow before production:

1. Create Supabase dev branch.
2. Apply migrations to dev branch.
3. Run SQL tests against dev branch.
4. Run advisors:
   - security advisor
   - performance advisor
5. Fix all new warnings.
6. Merge branch only after Fastify code using new RPCs is deployed or deploy in safe order.

Use MCP tools if available:

- list migrations,
- apply migration,
- execute SQL tests,
- get advisors,
- merge branch.

### 5.8 Acceptance criteria

- User RPCs are not executable by anon.
- `rls_auto_enable()` is not executable by anon/authenticated.
- Read/list RPCs have fixed search paths.
- Missing FK indexes are added.
- `set_profile_watched_state` exists in live Supabase before public mark/unmark route deploy.
- Provider playback RPC exists before provider playback sync deploy.
- Tests prove cross-profile denial.

## 6. Workstream D: PAT behavior

### 6.1 Goal

PAT behavior must be explicit and deterministic for Supabase user-RLS-backed endpoints.

Current auth behavior:

- `src/http/plugins/auth.ts`
  - PAT token starts `cp_pat_`.
  - PAT auth sets `request.auth.accessToken = null`.
  - Supabase JWT user session stores original bearer token in `request.auth.accessToken`.
  - `requireUserSessionActor(...)` rejects non-`user` auth type.

Current watch route behavior:

- `src/http/routes/watch.ts` uses `requireUserSessionActor(...)` for all watch routes.
- PAT should therefore fail with 403 before any Supabase call.

### 6.2 Keep default policy

Default policy:

- PATs are rejected for all Supabase user-RLS-backed user-state routes.
- Do not add service-role fallback for PATs.
- Do not synthesize Supabase JWTs.
- Do not bypass RLS because a PAT authenticated locally.

Expected response:

- HTTP status: `403`
- Error message: `User session authentication required.`
- If error handler exposes code, assert current generated code from error handler.

### 6.3 Add tests

Extend `src/http/routes/watch.test.ts`.

Add local helper or test app that sets PAT actor:

```ts
app.decorateRequest('auth');
app.decorate('requireAuth', async (request) => {
  request.auth = {
    type: 'pat',
    appUserId: 'user-1',
    accessToken: null,
    ...other required fields
  } as never;
});
app.decorate('requireUserActor', ...);
app.decorate('requireUserSessionActor', same implementation as auth plugin or import real plugin if DB is stubbed);
```

Test all representative routes:

- `GET /v1/profiles/:profileId/watch/continue-watching`
- `POST /v1/profiles/:profileId/watch/events`
- `POST /v1/profiles/:profileId/watch/mark-watched`
- `POST /v1/profiles/:profileId/watch/unmark-watched`
- `PUT /v1/profiles/:profileId/watch/watchlist/:mediaKey`
- `PUT /v1/profiles/:profileId/watch/rating/:mediaKey`

Assert:

- status 403.
- no Supabase service method called.

### 6.4 Docs/OpenAPI

Search OpenAPI files for watch route auth descriptions.

Update if present:

- Supabase user session bearer token required.
- PAT not accepted for user-state Supabase-backed routes.
- Reason can be concise: route requires Supabase user session for RLS.

Run contract checks after OpenAPI edits:

```bash
npm run contract:check
```

### 6.5 Future PAT relay design, not part of this migration

If PAT support is required later:

- Add explicit trusted RPCs that accept `target_account_id` and `target_profile_id`.
- Fastify must authorize PAT scopes locally before service-role call.
- RPCs should be service-role only.
- Add separate audit logging.
- This must not be hidden fallback inside existing user-JWT routes.

### 6.6 Acceptance criteria

- PAT behavior tested.
- No route with user-RLS-backed Supabase calls accepts PAT.
- API docs do not imply PAT support for these routes.

## 7. Workstream E: full test stability

### 7.1 Goal

`npm test` should be usable without accidental local Postgres dependency for unit tests, or DB-dependent tests must be clearly separated.

Previous full-suite symptom:

- Full suite had failures caused by `connect ECONNREFUSED 127.0.0.1:5432`.
- Account deletion tests were one cause and have been fixed by transaction injection.

### 7.2 Rerun full suite first

Run:

```bash
npm test
```

Classify every failure:

- Category A: real code regression from current migration.
- Category B: unit test accidentally hits local Postgres/Redis.
- Category C: true integration test requiring services.
- Category D: flaky/network/provider test.

### 7.3 Fix Category B tests by dependency injection

Pattern:

1. Locate service that imports global DB function directly:
   - `withTransaction`
   - `withDbClient`
   - repository singleton that opens DB.
2. Add constructor dependency for transaction/client runner.
3. Default to real DB function in production.
4. Tests pass `NOOP_TRANSACTION` or fake client runner.
5. Fake client must implement minimal methods used by service:
   - `query(...)`
   - transaction callback shape.

Do this like `AccountDeletionService`:

- Add type:

```ts
type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;
```

- Constructor arg default:

```ts
private readonly transactionRunner: TransactionRunner = withTransaction
```

- Replace direct call:

```ts
return this.transactionRunner(async (client) => { ... });
```

### 7.4 Split integration tests if needed

If some tests genuinely require Postgres/Redis:

1. Rename files to `*.integration.test.ts`, or keep path and add guard.
2. Add package scripts:

```json
"test:unit": "node --import tsx --test \"src/**/*.test.ts\"",
"test:integration": "CRISPY_RUN_INTEGRATION_TESTS=1 node --import tsx --test \"src/**/*.integration.test.ts\""
```

3. Do not silently skip integration tests in CI unless CI has a separate integration job.
4. Document required local services:
   - Postgres at `DATABASE_URL`
   - Redis at `REDIS_URL`

### 7.5 Tests required for this migration

Must pass without local Postgres:

```bash
node --import tsx --test "src/http/routes/watch.test.ts"
node --import tsx --test "src/modules/users/account-deletion.service.test.ts"
node --import tsx --test "src/modules/integrations/provider-import.service.test.ts"
node --import tsx --test "src/modules/integrations/supabase-provider-history-writer.test.ts"
node --import tsx --test "src/modules/recommendations/*.test.ts"
```

Then:

```bash
npm run typecheck
npm run build
npm test
```

If OpenAPI changed:

```bash
npm run contract:check
```

### 7.6 Acceptance criteria

- Full test output is understood and documented.
- New migration-related unit tests do not require local Postgres.
- Any remaining DB-required tests are intentionally marked/split.
- Typecheck and build pass.

## 8. Workstream F: local watch source-of-truth cleanup

### 8.1 Goal

Remove retired local watch source-of-truth code after Supabase provider/recommendation paths are complete.

Do not delete local modules just because public watch routes no longer call them. Some may still be needed for:

- metadata hydration,
- recommendation reads before cutover,
- side effects,
- outbox/recompute,
- admin/debug/backfill,
- tests.

### 8.2 Audit targets

Search and classify:

- `src/modules/watch/event-ingest.service.ts`
- `src/modules/watch/watch-v2-write.service.ts`
- `src/modules/watch/watch-export.service.ts`
- `src/modules/watch/personal-media.service.ts`
- `src/modules/watch/profile-watch-data-state.repo.ts`
- local watch migrations under `migrations/`
- any routes calling local watch services
- any recommendation services calling local watch export

Use grep patterns:

- `new WatchEventIngestService`
- `WatchEventIngestService`
- `WatchExportService`
- `PersonalMediaService`
- `watchV2WriteService`
- local table names used by watch source-of-truth.

### 8.3 Retirement order

1. Keep local watch read/export modules until recommendation source mode `supabase` is stable.
2. Move side effects out of `WatchEventIngestService` into `WatchMutationSideEffectsService`.
3. Update recommendations to use Supabase mode.
4. Remove code paths that write local watch state from public user operations.
5. Keep read-only/backfill/admin tools only if explicitly used.
6. Add guard to prevent reintroducing retired modules in public routes.

### 8.4 Add retired module guard

Existing script:

- `scripts/guard-retired-modules.ts`
- npm script: `npm run guard:retired-modules`

Update guard after cleanup:

- public routes must not import `WatchEventIngestService`.
- public routes must not import `WatchV2WriteService`.
- no module may import deleted `supabase-watch-writer.ts`.
- service-role Supabase writes must only be from allowed files:
  - provider import writer,
  - auth admin service,
  - future recommendation trusted reader if direct service-role reads are allowed,
  - explicit admin/backfill modules.

### 8.5 Local database cleanup

Do not drop local watch tables immediately.

Phased DB plan:

1. Stop public writes.
2. Stop recommendation reads.
3. Run shadow/parity period.
4. Freeze local tables as legacy backup.
5. Add migration to mark tables deprecated or remove only after backup/export.

### 8.6 Acceptance criteria

- No public route writes local watch source-of-truth.
- Recommendation signals no longer depend on local watch export in Supabase mode.
- Side effects still happen.
- Guard prevents accidental reintroduction.
- Local table deletion is separate explicit migration, not bundled with app refactor.

## 9. Recommended implementation slices

### Slice 1: provider import expansion

Files:

- `src/modules/integrations/supabase-provider-history-writer.ts` or new provider import writer
- `src/modules/integrations/provider-import.service.ts`
- `src/modules/integrations/provider-import.service.test.ts`
- new writer test
- `supabase/migrations/*provider_import_playback*.sql`
- `supabase/tests/rpc_provider_imports_service_role.sql`

Run:

```bash
node --import tsx --test "src/modules/integrations/provider-import.service.test.ts"
node --import tsx --test "src/modules/integrations/supabase-provider-history-writer.test.ts"
npm run typecheck
npm run build
```

### Slice 2: Supabase hardening

Files:

- `supabase/migrations/*harden_user_watch_rpc_grants*.sql`
- `supabase/migrations/*add_missing_fk_indexes*.sql`
- `supabase/tests/grants_user_watch_rpc.sql`
- `supabase/tests/rls_profile_membership.sql`
- `supabase/tests/rpc_set_profile_watched_state.sql`

Run:

- Apply to Supabase dev branch.
- Run SQL tests.
- Run Supabase security/performance advisors.

### Slice 3: PAT tests/docs

Files:

- `src/http/routes/watch.test.ts`
- OpenAPI files if auth behavior is documented there
- generated docs if OpenAPI changed

Run:

```bash
node --import tsx --test "src/http/routes/watch.test.ts"
npm run contract:check
npm run typecheck
```

### Slice 4: side effects and recommendation shadow mode

Files:

- `src/modules/watch/watch-mutation-side-effects.service.ts`
- `src/http/routes/watch.ts`
- `src/modules/recommendations/supabase-recommendation-signal-reader.ts`
- `src/modules/recommendations/recommendation-data.service.ts`
- `src/modules/recommendations/profile-input-signal.facade.ts`
- tests

Run:

```bash
node --import tsx --test "src/http/routes/watch.test.ts"
node --import tsx --test "src/modules/recommendations/*.test.ts"
npm run typecheck
npm run build
```

### Slice 5: switch recommendation source and cleanup

Preconditions:

- Supabase provider import sync stable.
- Supabase hardening migration applied.
- Shadow parity acceptable.
- Side effects working.

Actions:

- Set `RECOMMENDATION_SIGNAL_SOURCE=supabase` in staging.
- Run recompute/backfill if needed.
- Remove/guard retired public local watch write modules.
- Keep local legacy tables until explicit cleanup migration.

Run:

```bash
npm run guard:retired-modules
npm test
npm run typecheck
npm run build
```

## 10. Final definition of done

The remaining migration is complete when all are true:

1. Provider imports write history, watchlist, ratings, and playback/continue facts to Supabase.
2. Public watch routes use only user JWT Supabase RPCs and reject PATs.
3. Supabase RLS/RPC/grants are versioned in repo and tested.
4. Anon cannot execute user/security-definer RPCs.
5. `rls_auto_enable()` is not callable by anon/authenticated.
6. Function search path advisor warnings for list RPCs are fixed.
7. Missing FK indexes are added.
8. Recommendation inputs can read from Supabase through Fastify backend code.
9. RECO never reads Supabase directly.
10. Side effects previously performed by local watch ingest still run after successful Supabase mutations.
11. Full unit test suite either passes without local DB or DB-required tests are explicitly split.
12. No dormant unsafe service-role direct writer exists.
13. No docs say Supabase is auth-only.
14. `npm run typecheck` passes.
15. `npm run build` passes.
16. Relevant focused tests pass.
17. Supabase dev branch advisors are reviewed after migrations.
