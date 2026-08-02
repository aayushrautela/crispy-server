# Streamline plan: per-signal reads, no bundle

> Status: **Partially implemented; this revision extends the contract to a single `ClientMediaCard` read shape for every consumer.** The single `recommendation-bundle` endpoint, the `ProfileSignalBundle`/`ProfileInputSignal` cache, and the `RecommendationSignalBundle` + `Reco*Signal` types have all been removed from Crispy Server. RECO already reads the per-signal routes directly. **Outstanding work:** collapse the per-signal read shape from raw `BaseItemDto` (with display fields null) to the same `ClientMediaCard` envelope the public routes return, delete `WatchMetadataEnrichmentService` + `AdminWatchReadService` + reco's `CatalogService` + reco's `signal_bundle_mapper`/`signal_assembler`, and collapse the duplicate `parseHomeWriteBody` into the unified `RecoListWriteRequest` parser. The §2 "dismantle" list, §5 stepwise phases, and §9 end state below describe both the work that has already landed **and** this remaining single-card-shape work.

## Goal
Eliminate the `recommendation-bundle` endpoint and the duplicate reads behind it. **Eliminate the parallel `BaseItemDto` read path for reco.** RECO and a user read the **same** per-signal endpoints at `/v1/profiles/:profileId/...` and `/internal/apps/v1/...` and receive the **same `ClientMediaCard` envelope**. The only difference is who authenticates and what they can address:

- A user reads only their own profile (PAT/JWT → ownership check).
- RECO reads any profile (app-token → `accounts:all:read` → skips ownership).

Public read shape (`ClientMediaCard`), pagination, limits, sort order, and underlying SQL stay identical across the two routes, so this is a refactor at the auth/identity + read-time-enrichment layer, not a data-layer rewrite.

System ends up with one set of per-signal read routes, one service per signal, one cache layer (optional, private to those routes), one read-time card-enrichment pass, one write parser, and zero bundle-specific plumbing or dual-shape layers.

---

## 1. Definition of "per-signal" we keep

Each is **one route, one DB read, one result array**:

| Signal | New per-signal route (final shape) | Caller |
| --- | --- | --- |
| watch history | `GET /v1/profiles/:profileId/watch/history` (already) + `GET /internal/apps/v1/.../watch/history` | user / reco |
| watch ratings | `GET .../watch/ratings` + `GET /internal/apps/v1/.../watch/ratings` | user / reco |
| watchlist | `GET .../watch/watchlist` + `GET /internal/apps/v1/.../watch/watchlist` | user / reco |
| continue watching | `GET .../watch/continue-watching` + `GET /internal/apps/v1/.../watch/continue-watching` | user / reco |
| episodic follow (tracked series) | `GET .../watch/episodic-follow` + `GET /internal/apps/v1/.../watch/episodic-follow` | user / reco |
| taste (optional) | new pair of read routes (`/taste`) | user (optional) / reco |
| profile context (display name, kids, language, region) | `GET /v1/profiles/:profileId` already returns most; for reco: same payload via `/internal/apps/v1/.../profile-context` or piggyback on the first signal call | — |
| negative signals | if a real source appears later, add then | — |
| impressions | if a real source appears later, add then | — |

We do **not** invent new shapes. Each per-signal route returns the same `ClientMediaCard` envelope the public `/v1` route returns. The internal signal routes run the **same read-time card-enrichment pass** as the public routes; `BaseItemDto` is never returned on the wire to any consumer.

> **Single read-time enrichment pass for every consumer:** The internal signal routes do not skip enrichment. Every per-signal route returns fully-populated `ClientMediaCard` rows (`title`, `overview`, `year`, `images`, `trailerUrl`, `progress`, `parent`) produced by the unified `MetadataCardService`/`HomeHydrator` path. The reco worker reads `itemId` + `mediaType` directly off each card; the reco webui renders the cards as-is. No consumer runs its own `CatalogService` pass or looks up TMDB metadata by `ProviderIds.Tmdb`.

RECO calls these in parallel (one HTTP per signal) and assembles its own internal request in-process. The cost: 5 small HTTPs in parallel vs. 1 round-trip with a cached bundle. To compensate without losing responsiveness, we put a shared in-process read cache in front of each per-signal route so the second signal hit in the same window returns from memory — no bundle-shaped response, just transparent caching.

---

## 2. Current state to dismantle

5 layers that exist only because of `recommendation-bundle`:

```
src/modules/recommendations/profile-input-signal.facade.ts
src/modules/recommendations/profile-input-signal-cache.service.ts
src/modules/recommendations/profile-input-signal-cache.repo.ts
src/modules/recommendations/profile-input-signal-cache.types.ts
src/modules/recommendations/profile-input-signal-cache-refresh.service.ts
src/modules/recommendations/profile-input-signal-cache.invalidator.ts
src/modules/recommendations/profile-input-signal.types.ts              (ProfileInputSignalBundle, includes)
src/modules/recommendations/recommendation-generation.service.ts       (also has ProfileInputSignalFacade for non-API callers)
src/modules/apps/profile-signal-bundle.service.ts
src/modules/apps/profile-signal-bundle.repo.ts
src/modules/apps/profile-signal-bundle.types.ts                       (ProfileSignalBundle, includes, defaults)
src/http/routes/internal-apps.routes.ts (the bundle handler)
src/http/routes/internal-apps.routes.test.ts (bundle handler test)
src/http/contracts/internal-apps.ts   (bundle route schema)
src/http/app.ts                       (wiring of facade + cache + bundle service)
openapi/internal-services.v1.yaml     (`recommendation-bundle` path + schemas)
```

Plus duplicated reads in `src/modules/integrations/admin-watch-read.service.ts` (parallel to `src/modules/integrations/local-user-watch.service.ts`).

Reco-side:
```
src/app-api/client.ts                 (getRecommendationBundle)
src/app-api/schemas.ts                (RecommendationSignalBundleSchema)
src/app-api/types.ts                  (RecommendationSignalBundle, RecommendationBundleEnvelope)
src/app-api/signal_bundle_mapper.ts   (whole file — maps bundle → GenerateRequest)
src/app-worker/recompute_event_worker.ts (calls getRecommendationBundle)
src/routes/webui.ts                   (two getRecommendationBundle calls)
src/generated/contracts/types.ts      (generated bundle types)
```

All of the above is to-be-removed or replaced.

---

## 3. Target architecture

### 3.1 One signal endpoint shape, two caller models

For every signal `S` in the table above:

- **Public route** stays at `/v1/profiles/:profileId/watch/S` (existing).
- **Internal route** mirrors it at `/internal/apps/v1/accounts/:accountId/profiles/:profileId/watch/S`.

Both routes:

1. Resolve caller identity:
   - Caller sends a user JWT/PAT → `requireAuth` + ownership check (`requireOwnedProfile`).
   - Caller sends the reco app token (matches `RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH`) → `requireRecommenderAuth` + scope check `profiles:signals:read` + grant check `profileSignals:*:read`. If they hold `accounts:all:read`, **skip ownership**; otherwise call `requireOwnedProfile`.
2. Resolve caller's `accountId`+`profileId`:
   - JWT/PAT caller: `accountId` from token, `profileId`/`:S` from URL — must own the profile.
   - reco caller: `:accountId` and `:profileId` come from the URL (any path is acceptable).
3. Call **the same service** `readSignalService.readS({ accountId, profileId, limit, cursor, since? })`.
4. Same response shape: `ClientMediaCard[]` for watch signals (one card per row, produced by the unified read-time card-enrichment pass — same path as public `/home` cards). The raw `BaseItemDto`/`BaseItemDtoQueryResult` shape is no longer returned on any per-signal route.

### 3.2 One set of read services (no Admin copy)

Replace the binary `LocalUserWatchService / AdminWatchReadService` with a **single service** that takes caller's `(accountId, profileId)` explicitly and trusts the route layer for ownership. Concretely:

- `LocalUserWatchService` becomes the only class. Methods become `listHistoryPage(client, params)` with `params = { accountId, profileId, limit, cursor, since? }`.
- The public user route fills `accountId = actor.accountId` from the token.
- The internal reco route fills `accountId` and `profileId` from URL params.
- `AdminWatchReadService` is **deleted**; the 5 callers (the bundle facade, recommendation-generation service) drop their `profiles-signals:read` indirection and call the unified service.
- `ProfileAccessService.assertProfileAccess(client, { accountId, profileId })` is kept at the route layer to give "ownership on explicit args" semantics; the service no longer needs an explicit identity check.

### 3.2.1 One read-time card-enrichment pass (no dual shape)

The public `/v1/profiles/:profileId/watch/*` routes and the internal `/internal/apps/v1/.../signals/watch/*` routes run **the same** card-enrichment pass and return **the same** `ClientMediaCard[]` shape. There is no parallel raw-`BaseItemDto` path for the internal routes.

Concretely:

- `WatchMetadataEnrichmentService` (`src/modules/watch/watch-metadata-enrichment.service.ts`) is **deleted**. Its `enrichContinueWatchingItems` / `enrichRegularMediaItems` behavior is folded into the existing `MetadataCardService.buildCardView` + `HomeHydrator.hydrateCard` path that already materializes `ClientMediaCard`.
- Both the public watch routes (`src/http/routes/watch.ts`) and the internal signal routes (`src/http/routes/internal-apps.routes.ts`) call the unified hydrator path; both return `ClientMediaCard[]`.
- The reco worker reads `itemId` + `mediaType` directly off each card; the reco webui renders the cards as-is.
- No consumer runs a `CatalogService` pass, looks up TMDB metadata by `ProviderIds.Tmdb`, or overlays display fields on each row.

### 3.3 Optional: an in-process read cache, *not* a bundle

To preserve the latency win of today's bundle without keeping the bundle abstraction, introduce a thin transparent cache decorator:

```
class WatchReadCache {
  // wraps WatchReadService.
  // getOrLoad(key = `watch:${accountId}:${profileId}:${family}:${limitHash}`, loader => Promise<payload>)
  // TTL per family (history=10m, ratings=10m, watchlist=10m, continueWatching=2m, episodicFollow=10m).
  // In-process: a Map + setTimeout; or Redis with a short TTL if multi-process.
}
```

- If RECO is the only multi-call subscriber, even an in-process `Map<string, { expiresAt: Date; payload }>` decoder is enough — already cuts the second 5-way parallel call to zero.
- Invalidated by watch-write events (recordPlaybackState, markWatched, putWatchlist, putRating, dismissContinueWatching, episodic follow changes). The existing watch-write routes already get a `ProfileInputSignalCacheInvalidator` injected — rename that to `WatchReadCacheInvalidator` and let it call `cache.invalidate(accountId, profileId, family)`.

No factory-shape responses. No `ProfileInputSignalBundle`. No per-section re-mapping in reco. The cache is invisible to the server contract.

### 3.4 Per-signal taste read (only if you want taste as an input)

If you want taste as an independent signal, add it the same way:

- New source: `src/modules/recommendations/taste-profile.repo.ts` → already exists; expose a `getTasteForProfile(accountId, profileId): ProfileTasteSignals` (mirror the types already in `profile-signal-bundle.types.ts`).
- Two routes: `GET /v1/profiles/:profileId/taste` and `GET /internal/apps/v1/accounts/:accountId/profiles/:profileId/taste`.
- Same auth split: user owns ⇒ user token; any profile ⇒ reco with `accounts:all:read`.

### 3.5 Auth wiring (single change in `internal-apps.routes.ts`)

For every existing `PUT /internal/apps/v1/.../recommendations/...`-style write route we already use `requireRecommenderAuth`. Reuse:

```ts
async function resolveProfileSignalPrincipal(request, { accountId, profileId }) {
  if (header startsWith 'Bearer cp_pat_') {
    requireAuth + requireScopes(['recommendations:write'])
    assert PAT.appUserId === accountId (for custom source)
    requireOwnedProfile(accountId, profileId) // throws 403 otherwise
    return derivedPrincipal
  }
  // reco / fallback / any app token:
  const principal = await requireRecommenderAuth(request)
  requireScope(principal, 'profiles:signals:read')
  if (!principal.scopes.includes('accounts:all:read')) {
    await requireOwnedProfile(accountId, profileId)
  }
  return principal
}
```

This same helper is wired into every new `/internal/apps/v1/.../watch/S` route (history, ratings, watchlist, continue-watching, episodic-follow, taste). One pattern, per-signal.

### 3.6 Scopes/grants to touch in DB

`migrations/0022_register_home_ingest_apps.sql` already grants `reco` and `fallback` `accounts:all:read` + `profiles:signals:read`. No new grants needed; we just keep them. PATs don't carry these scopes → ownership still enforced for `custom` users.

---

## 4. RECO side: assemble per-signal reads

RECO today:

```ts
const bundle = await appClient.getRecommendationBundle(accountId, profileId)
const request = mapSignalBundleToGenerateRequest({ ... signalBundle: bundle })
```

After:

```ts
// in appClient — one method per signal, parallel-fetched
const [profileContext, history, ratings, watchlist, continueWatching, episodicFollow] =
  await Promise.all([
    appClient.getProfileContext(accountId, profileId),     // or reuse /v1/profiles/:p
    appClient.getHistory(accountId, profileId, { limit: 100 }),
    appClient.getRatings(accountId, profileId, { limit: 100 }),
    appClient.getWatchlist(accountId, profileId, { limit: 50 }),
    appClient.getContinueWatching(accountId, profileId, { limit: 20 }),
    appClient.getEpisodicFollow(accountId, profileId, { limit: 20 }),
  ])
```

Each `get*` call hits the corresponding `/internal/apps/v1/.../watch/S` route and parses a `ClientMediaCard[]` envelope exactly as the public route does. No new shape, no special envelope, **no `BaseItemDto` on the wire anywhere**.

`signal_bundle_mapper.ts` (and any renamed `signal_assembler.ts`) is **deleted entirely**. Its `BaseItemDto → ProviderIds.Tmdb + Type + UserData` extraction no longer exists because the cards already carry canonical `itemId` + normalized `mediaType`. A single shared `cardToRecoInput` helper reads `itemId` + `mediaType` off each `ClientMediaCard` and feeds the existing `GenerateRequest` (which already accepts `watchHistory, ratings, watchlist, continueWatching`). Add an optional `episodicFollow` array (or fold it into `continueWatching` and `watchlist` producer-side; orthogonality is up to taste here).

`webui.ts`'s two `getRecommendationBundle` calls get replaced with the same per-signal parallel fetch rendered directly off the returned `ClientMediaCard[]` (no `CatalogService`, no row overlay, no in-page aggregator beyond assembling the per-signal arrays).

`generated/contracts/types.ts` regenerated after OpenAPI update drops `recommendation-bundle` types and reflects the `ClientMediaCard` read shape.

---

## 5. Step-by-step implementation order

Do this in **lockstep**, server first because reco depends on the new routes.

### Phase 0 — contracts (no behavior change)
1. In `crispy server/openapi/internal-services.v1.yaml`:
   - Add per-signal paths `GET /internal/apps/v1/accounts/{accountId}/profiles/{profileId}/watch/{history|ratings|watchlist|continue-watching|episodic-follow}`.
   - Reuse the existing public schemas (`WatchHistoryListResponse`, etc., already in `public-app.v1.yaml`) — add `$ref` imports.
   - Delete the `recommendation-bundle` path and `RecommendationSignalBundleResponse` schema.
   - Re-export list of new operations.
2. Regenerate server's `src/http/contracts/internal-apps.ts`.

### Phase 1 — server: collapse reads into unified service
3. Refactor `LocalUserWatchService` (in `src/modules/integrations/local-user-watch.service.ts`) to take `{ client?, accountId, profileId, limit, cursor, since? }` explicitly. Drop any identity-from-JWT assumption. The remaining JWT-context call in user-facing routes passes `accountId` from the actor token.
4. Delete `AdminWatchReadService` (`src/modules/integrations/admin-watch-read.service.ts`).
5. Update `src/http/routes/watch.ts`: every existing `localUserWatchService.list*(...)` call now passes `actor.accountId` explicitly. No other change to user routes.

### Phase 2 — server: add internal per-signal routes
6. In `src/http/routes/internal-apps.routes.ts`, add a thin helper `resolveProfileSignalPrincipal` that handles user-PAT vs reco-app-token (see §3.5). Reject with the right 403/423 code.
7. Register five new GET routes:
   - `GET /internal/apps/v1/accounts/:accountId/profiles/:profileId/watch/history`
   - `GET .../ratings`
   - `GET .../watchlist`
   - `GET .../continue-watching`
   - `GET .../episodic-follow`
   - (Optional) `GET .../taste` (with new taste read service from `taste-profile.repo.ts`).
   Each calls the unified `LocalUserWatchService` after `resolveProfileSignalPrincipal`.
8. Wire the new routes into `app.ts`'s `registerInternalAppsRoutes`.

### Phase 3 — server: transparent cache (optional but recommended)
9. Rename `profile-input-signal-cache.service.ts` → `watch-read-cache.service.ts`. Move it next to the watch module, drop `SectionPayload`/`Decisions` types — replace with per-family get/set.
10. Update cache wiring in `app.ts` to inject the cache into each route's read service.
11. Update invalidation: rename `ProfileInputSignalCacheInvalidator` → `WatchReadCacheInvalidator` and call from the existing watch-write routes (`recordPlaybackState`, `putWatchlist`, `putRating`, `markWatched`, `unmarkWatched`, `dismissContinueWatching`, episodic follow changes).
12. Cache TTLs match the per-family mapping already in `app.ts`.

### Phase 4 — server: delete bundle-only plumbing
13. Delete the bundle route `/internal/apps/v1/.../signals/recommendation-bundle` from `internal-apps.routes.ts` and its schema/contract.
14. Delete:
    - `src/modules/apps/profile-signal-bundle.service.ts`
    - `src/modules/apps/profile-signal-bundle.repo.ts`
    - `src/modules/apps/profile-signal-bundle.types.ts`
    - `src/modules/recommendations/profile-input-signal.facade.ts`
    - `src/modules/recommendations/profile-input-signal-cache-refresh.service.ts`
    - `src/modules/recommendations/profile-input-signal.types.ts`
    - `src/modules/recommendations/profile-input-signal-cache.types.ts` (move/rename to watch module where used)
    - References to all of the above from `app.ts`, `recommendation-generation.service.ts`, `internal-apps.routes.test.ts`, `recommendation-admin.service.test.ts`.
15. Migration: `migrations/0028_drop_recommendation_signal_bundle_tables.sql` if cached bundle table is unused (audit the schema first; the cache repo almost certainly has a Postgres-backed cache table — drop empty, archive if it ever held data).
16. Update `scripts/guard-retired-modules.ts` to add `ProfileSignalBundle|profile-signal-bundle|recommendation-bundle|ProfileInputSignal|profile-input-signal|/signals/recommendation-bundle`.

### Phase 5 — reco: assemble per-signal reads
17. In reco `src/app-api/client.ts`:
    - Remove `getRecommendationBundle`, `RecommendationSignalBundleSchema`, `RecommendationSignalBundle`.
    - Add: `getProfileContext`, `getHistory`, `getRatings`, `getWatchlist`, `getContinueWatching`, `getEpisodicFollow`. Each calls the corresponding `/internal/apps/v1/.../watch/S` route and parses back the same `ClientMediaCard[]` shape.
    - Add a helper `assembleGenerateRequest({ accountId, profileId, profileContext, history, ratings, watchlist, continueWatching, episodicFollow })` that produces the existing `GenerateRequest`. The mapping is a single `cardToRecoInput` step that reads `itemId` + normalized `mediaType` (cards already carry `"movie" | "tv" | "season" | "episode"` -> map season/episode to `"tv"`) off each card; **no `ProviderIds.Tmdb` extraction, no `UserData` field reading, no `Type === 'Series'` mapping** because MAIN already canonicalized identity at materialization time.
18. Delete `src/app-api/signal_bundle_mapper.ts` (and any renamed `signal_assembler.ts`) entirely. Delete `src/app-api/types.ts`'s `RecommendationSignalBundle`, `RecommendationBundleEnvelope`, the eligibility/limits wrappers. Delete reco's `CatalogService` (the TMDB-by-`ProviderIds.Tmdb` overlay). The `cardToRecoInput` helper does not inherit any responsibility from these — it is a fresh 5-line function.
19. Update `src/app-worker/recompute_event_worker.ts` to call the new client methods (parallel `Promise.all`) and pass the assembled request to `jobService.submit`.
20. Update `src/routes/webui.ts` (two call sites) the same way: the per-signal `ClientMediaCard[]` responses are rendered as-is; no per-row overlay, no `CatalogService` call.

### Phase 6 — reco: write back via batch (existing server fix, finally exercised)
21. Update `src/jobs/execute.ts`: replace the per-listKey `upsertRecommendationList` loop with **one** `appClient.batchUpsertRecommendationLists(...)` call per profile, carrying all four rails (`category-tabs`, `hero-carousel`, `content-rails`, `collection-rails`) in one snapshot, with a per-profile idempotency key. Reuses server `batchUpsert` → `writeHome` (already atomic per `(profile, source)`).

### Phase 6.5 — server: collapse to single card shape (the dual-shape fix)
This is the key step that retires the parallel `BaseItemDto` read path and every consumer-side enrichment layer. It runs on the server before the matching reco side of Phase 5 is merged, and reco is co-deployed with it.

22. In `src/modules/metadata/metadata-card.service.ts` (or `HomeHydrator.hydrateCard`): extend `buildCardView` to accept the internal-route row shape (provider-ref tuples for fallback templates and canonical `itemId` for stored rows) the same way it already does for the home path. This becomes the **only** path that materializes a `ClientMediaCard`.
23. Update `src/http/routes/internal-apps.routes.ts`: every per-signal route calls the unified `LocalUserWatchService.list*` (the raw row reader) and then runs cards through the same hydrator the public `/home` route uses. The `BaseItemDtoQueryResult` envelope becomes a `ClientMediaCard`-shaped envelope. Drop the "enrichment is NOT run on these routes" comment block entirely.
24. Update `src/http/routes/watch.ts`: every public `/v1/profiles/:profileId/watch/*` route switches from `WatchMetadataEnrichmentService.enrichContinueWatchingItems`/`enrichRegularMediaItems` to the unified hydrator path. Both `/v1` watch routes and `/internal/apps/v1` signal routes now produce `ClientMediaCard[]` through the same code path.
25. Update `src/http/routes/admin-api.ts`: the four watch endpoints that currently call `watchMetadataEnrichmentService.enrich*` switch to the unified hydrator. No admin-specific enrichment path remains.
26. Delete `src/modules/watch/watch-metadata-enrichment.service.ts` and its test `watch-metadata-enrichment.service.test.ts`. Its behavior lives inside `MetadataCardService`/`HomeHydrator` now.
27. Fold `watch-media-card-cache.service.ts` (and any cache-miss refresh) into the unified card path if it is not already shared. The cache that backs enrichment is now one cache, used by every card materialization call.
28. Update `openapi/internal-services.v1.yaml`: the per-signal `ProfileReadSignalResponse` schema is replaced (or its items' `$ref` is retargeted) to `ClientMediaCard[]`, not `BaseItemDtoQueryResult`. Regenerate `openapi/generated/internal-services.v1.types.ts`.
29. Update `openapi/public-app.v1.yaml` watched-list response schemas if they still reference `BaseItemDtoQueryResult`: items become `ClientMediaCard` too. Regenerate generated types.
30. Re-run the watch + internal-apps tests; the assert shapes change from `Items[].Name` / `Items[]ProviderIds.Tmdb` to `Items[].title` / `Items[].itemId` / `Items[].mediaType`.

### Phase 7 — server: collapse duplicate write parser
31. In `src/http/routes/recommendation-outputs.ts`: delete `parseHomeWriteBody` and route the public `PUT /v1/profiles/:profileId/home` body through the same `RecoListWriteRequest` parser the internal `PUT /internal/apps/v1/.../recommendations/lists/:listKey` route uses. The two routes shared the same shape already; they now share the same parser function.
32. Move the shared parser into `src/modules/recommendations/` (next to `reco-contract.types.ts`) so both the public and internal routes import it rather than each having an inline copy.

### Phase 8 — migration / cleanup
33. Add `crispy server/migrations/0028_drop_recommendation_signal_bundle_tables.sql` (Phase 4 already).
34. Update `docs/specs/client-reco-pipeline-spec.md` to reflect single-card-shape read paths (already done in this revision).
35. Update `docs/architecture/recommendation-engine.md` → "Source data and AI generation flow" to enumerate per-signal reads returning `ClientMediaCard` and to remove the "enrichment note" / `CatalogService` paragraph (done in a sibling change).
36. Update `docs/api/recommendations.md` → same.
37. `crispy recommendation engine/README.md` already implicitly says RECO pulls its own data; tighten the language: "RECO calls the same per-signal read endpoints the app uses, only with the reco service token, and receives the same `ClientMediaCard[]` shape the app receives."
38. Update `scripts/guard-retired-modules.ts` to add `WatchMetadataEnrichmentService|watch-metadata-enrichment|AdminWatchReadService|admin-watch-read|CatalogService|signal_bundle_mapper|signal_assembler|parseHomeWriteBody`. The guard must fail any future PR that reintroduces a dual-shape enrichment path or a duplicate read service.

---

## 6. Migration / compatibility

**There is no legacy compatibility kept.** This refactor deliberately removes the parallel `BaseItemDto` read path, all per-consumer enrichment layers, and the duplicate write parser, with no dual-shape fallback alongside. Co-deploy server + reco in one release boundary; RECO's old `BaseItemDto` assumptions, `CatalogService`, and `signal_bundle_mapper` must be gone from the reco repo before the server stops returning `BaseItemDtoQueryResult` on the internal signal routes.

- **Client apps**: the public `/v1/profiles/:profileId/watch/*` routes switch their response shape from `BaseItemDtoQueryResult` (PascalCase `Items[]` with `Name`/`Overview`/`ImageTags`) to `ClientMediaCard[]` (camelCase cards with `title`/`overview`/`images`). This is a breaking change for any client already shipped against the old shape. Acceptable per the spec's **no-legacy-compatibility** non-goal: co-deploy clients with the server, or treat the migration as a coordinated client release.
- **RECO engine**: HTTP path changes from `/signals/recommendation-bundle` to per-signal paths **and** the per-signal item shape changes from `BaseItemDto` to `ClientMediaCard`. Co-deploy server + reco; RECO's old `signal_bundle_mapper`/`CatalogService` must be deleted in the same release. No graceful fallback is available outside the engine's MQ retry.
- **Operators**: drop the bundle schema migration on the next DB deploy.
- **Admins**: the audit log still records per-principal signal reads; the bundle handler is gone but its logger/diagnostics entries vanish — keep an audit backup if needed.

---

## 7. Tests to add / move

- Server `internal-apps.routes.test.ts`: remove bundle-handler test block. Add per-signal tests, one per route:
  - user-PAT caller → 200 own data only, 403 other account
  - reco app-token caller with `accounts:all:read` → 200 any profile
  - app-token without `accounts:all:read` → 403
  - the response carries `ClientMediaCard` rows (assert `Items[0].itemId`, `Items[0].mediaType`, `Items[0].title`, `Items[0].images`), **not** `BaseItemDto` fields (`Name`, `ProviderIds.Tmdb`)
  - cache invalidation on a write (history cache evicts on `recordPlaybackState`)
- Server `watch.test.ts`: the watch route tests assert `ClientMediaCard` cards on the response, not the old `BaseItemDto` shape.
- Server: add a new guard test that fails if `WatchMetadataEnrichmentService`, `AdminWatchReadService`, `catalogService`/`CatalogService`, `signal_bundle_mapper`/`signal_assembler`, or `parseHomeWriteBody` reappears in `src/`.
- Reco `client.test.ts`: assert per-signal methods issue `Promise.all` and parse `ClientMediaCard[]` rows; assert `assembleGenerateRequest` reads `itemId` + `mediaType` off cards (not `ProviderIds.Tmdb` / `Type` / `UserData`).
- Reco `recompute_event_worker.test.ts`: assert the per-signal calls succeed and the assembled request has the expected counts.
- Reco `execute.ts` test: assert a single `batchUpsertRecommendationLists` call carries all four rails with a per-profile idempotency key.
- Reco webui test: assert webui renders the per-signal `ClientMediaCard` rows directly; no `CatalogService` is invoked.

---

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| RECO becomes a higher-fanout client (5 calls instead of 1) | Per-family cache (Phase 3) covers bursty reads; serves all callers (user app can also benefit). |
| Inconsistent identity assumptions between user route and reco route | Single `resolveProfileSignalPrincipal` helper; one ownership-vs-scope branch in one place; covered by tests. |
| Removing bundle breaks WebUI if it relied on bundle-only fields | WebUI's two call sites are the only ones; switch them to per-signal `ClientMediaCard[]` reads rendered directly. |
| Cache eviction race between writes and reco reads | Existing invalidator already runs inside the same DB transaction on watch writes; re-target it at the new cache. |
| Auth drift (`accounts:all:read` accidentally given to a non-reco app) | Out of scope — already locked by migration `0022`. The `app_source_ownership` for `custom` apps is per-account, not all-account. |
| OpenAPI drift between server specs | Phase 0 (publication/contract) before Phase 4 (delete bundle) keeps schema and handler in lockstep. |
| Public watch route response shape change breaks shipped client apps | No legacy compatibility is kept (per spec non-goals); coordinate a single client release with the server deploy. The `ClientMediaCard` shape is the one shape going forward. |
| Cards on internal routes lose signal-only fields (`UserData.PlayedPercentage`, `LastPlayedDate`, `PlayCount`, `Rating`) | The worker cannot read `UserData` from a `ClientMediaCard`. Choose one: (a) expose the needed fields as explicit card fields (`progress.playCount`, `progress.percent`, `progress.lastPlayedAt`, `progress.userRating` — already part of `ClientProgress`), or (b) keep the per-signal reads card-shaped but also pass a small immutable `signalMeta` block alongside the card for the worker-only fields. Option (a) is preferred — `ClientProgress` already covers all fields the worker needs. |
| Cards lack the provider refs the worker still needs on the write side | The worker writes `RecoWriteItem` (provider refs + `type`) — these come from MAIN's canonical resolution at materialization, not from the card. The card carries `itemId`; MAIN resolves the write-side provider refs from `itemId` server-side. No provider refs leak onto the read side. |

---

## 9. End state (what the system looks like after)

Server:
- one set of per-signal read routes at `/v1` and `/internal/apps/v1`,
- one additional `profile-meta` route at `/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/profile-meta` returning `{ profileName, isKids, language, region, watchDataOrigin }` for reco's `GenerateRequest.profileContext` assembly — reco pulls this in parallel with the watch signal reads. Added a corresponding `ProfileMetaReadResponse` schema to `internal-apps.v1.yaml`,
- taste read/write at `/internal/apps/v1/.../signals/taste`,
- one unified read service (`LocalUserWatchService`) per signal; `AdminWatchReadService` deleted,
- one read-time card-enrichment pass (`MetadataCardService`/`HomeHydrator`) shared by every read path — public watch, public home, admin, internal signal routes; `WatchMetadataEnrichmentService` deleted,
- one optional transparent cache,
- one write path (`HomeWriteService.writeHome`) shared by `reco`, `custom`, `fallback`,
- one write body parser (`RecoListWriteRequest`) shared by the public `PUT /v1/.../home` route and the internal `PUT /internal/apps/v1/.../recommendations/lists/:listKey` route; `parseHomeWriteBody` deleted,
- one outbox notifier (`RecommenderNotifier`) fire-and-forget to RECO.

Reco:
- a single `assembleGenerateRequest` step issues a `Promise.all` of 8 calls: 6 per-signal reads (history, ratings, watchlist, continue-watching, episodic-follow, taste) + profile-meta + eligibility. Each per-signal response is `ClientMediaCard[]`; the helper applies `cardToRecoInput` (reads `itemId` + `mediaType` off each card) and feeds the existing `GenerateRequest`. No on-wire bundle envelope, no `BaseItemDto`, no `ProviderIds.Tmdb` extraction, no `UserData` field parsing,
- `CatalogService` is deleted — the webui renders `ClientMediaCard[]` directly,
- `signal_bundle_mapper.ts` / `signal_assembler.ts` is deleted — replaced by the inline `cardToRecoInput` 5-line helper,
- one `batchUpsertRecommendations` per profile carrying all rails (Phase 6 removed the per-listKey `upsertRecommendationList` loop).

Two repos, one auth framework, one card shape on every read path, one write shape and one parser on every write path, no bundle-only types, no dual-shape enrichment, no per-consumer re-resolution of TMDB metadata, no legacy `BaseItemDto` on the wire anywhere downstream of MAIN.
