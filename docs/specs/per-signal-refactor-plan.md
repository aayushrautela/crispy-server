# Streamline plan: per-signal reads, no bundle

## Goal
Eliminate the `recommendation-bundle` endpoint and the duplicate reads behind it. RECO and a user read the **same** per-signal endpoints at `/v1/profiles/:profileId/...` and `/internal/apps/v1/...`. The only difference is who authenticates and what they can address:

- A user reads only their own profile (PAT/JWT → ownership check).
- RECO reads any profile (app-token → `accounts:all:read` → skips ownership).

Public-read shape (`BaseItemDto`), pagination, limits, sort order, and underlying SQL stay identical to today, so this is a refactor at the auth/identity layer, not a data-layer rewrite.

System ends up with one set of per-signal read routes, one service per signal, one cache layer (optional, private to those routes), and zero bundle-specific plumbing.

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

We do **not** invent new shapes. Each per-signal route returns the same `PaginatedWatchCollection<BaseItemDto>` it already returns.

> **Consequence for display consumers:** Because these routes skip the `WatchMetadataEnrichmentService` pass, items return with display fields (`Name`, `Overview`, `ProductionYear`, `Genres`, `ImageTags`, etc.) as null. The reco worker does not need display fields — it reads only `Type`, `ProviderIds`, and `UserData`. Display-facing consumers (e.g. the reco webui) must enrich on their own read path using `ProviderIds.Tmdb`.

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
4. Same response shape: `PaginatedWatchCollection<BaseItemDto>` for watch signals.

### 3.2 One set of read services (no Admin copy)

Replace the binary `LocalUserWatchService / AdminWatchReadService` with a **single service** that takes caller's `(accountId, profileId)` explicitly and trusts the route layer for ownership. Concretely:

- `LocalUserWatchService` becomes the only class. Methods become `listHistoryPage(client, params)` with `params = { accountId, profileId, limit, cursor, since? }`.
- The public user route fills `accountId = actor.accountId` from the token.
- The internal reco route fills `accountId` and `profileId` from URL params.
- `AdminWatchReadService` is **deleted**; the 5 callers (the bundle facade, recommendation-generation service) drop their `profiles-signals:read` indirection and call the unified service.
- `ProfileAccessService.assertProfileAccess(client, { accountId, profileId })` is kept at the route layer to give "ownership on explicit args" semantics; the service no longer needs an explicit identity check.

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

Each `get*` call hits the corresponding `/internal/apps/v1/.../watch/S` route and parses a `PaginatedWatchCollection<BaseItemDto>` exactly as the public route does. No new shape, no special envelope.

`signal_bundle_mapper.ts` becomes `signal_assembler.ts` and is shrunk to a 1-screen function that maps `BaseItemDto → CanonicalMediaIdentity` per signal and feeds into the existing `GenerateRequest` (which already accepts `watchHistory, ratings, watchlist, continueWatching`). Add an optional `episodicFollow` array (or fold it into `continueWatching` and `watchlist` producer-side; orthogonality is up to taste here).

`webui.ts`'s two `getRecommendationBundle` calls get replaced with the same per-signal parallel fetch and an in-page aggregator.

`generated/contracts/types.ts` regenerated after OpenAPI update drops `recommendation-bundle` types.

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
    - Add: `getProfileContext`, `getHistory`, `getRatings`, `getWatchlist`, `getContinueWatching`, `getEpisodicFollow`. Each calls the corresponding `/internal/apps/v1/.../watch/S` route and parses back the same `PaginatedWatchCollection<BaseItemDto>` shape.
    - Add a helper `assembleGenerateRequest({ accountId, profileId, profileContext, history, ratings, watchlist, continueWatching, episodicFollow })` that produces the existing `GenerateRequest`.
18. Delete `src/app-api/signal_bundle_mapper.ts` and `src/app-api/types.ts`'s `RecommendationSignalBundle`, `RecommendationBundleEnvelope`, the eligibility/limits wrappers.
19. Update `src/app-worker/recompute_event_worker.ts` to call the new client methods (parallel `Promise.all`) and pass the assembled request to `jobService.submit`.
20. Update `src/routes/webui.ts` (two call sites) the same way.

### Phase 6 — reco: write back via batch (existing server fix, finally exercised)
21. Update `src/jobs/execute.ts`: replace the per-listKey `upsertRecommendationList` loop with **one** `appClient.batchUpsertRecommendationLists(...)` call per profile, carrying all four rails (`category-tabs`, `hero-carousel`, `content-rails`, `collection-rails`) in one snapshot, with a per-profile idempotency key. Reuses server `batchUpsert` → `writeHome` (already atomic per `(profile, source)`).

### Phase 7 — migration / cleanup
22. Add `crispy server/migrations/0028_drop_recommendation_signal_bundle_tables.sql` (Phase 4 already).
23. Update `docs/specs/client-reco-pipeline-spec.md`: replace "RECO signal bundle endpoint" with "RECO reads per-signal endpoints at `/internal/apps/v1/.../watch/{history,ratings,watchlist,continue-watching,episodic-follow,taste}`; payloads mirror the user-facing `/v1` shapes".
24. Update `docs/architecture/recommendation-engine.md` → "Source data and AI generation flow" to enumerate per-signal reads instead of one bundle.
25. Update `docs/api/recommendations.md` → same.
26. `crispy recommendation engine/README.md` already implicitly says RECO pulls its own data; tighten the language: "RECO calls the same per-signal read endpoints the app uses, only with the reco service token."

---

## 6. Migration / compatibility

- **Client apps**: nothing changes. They only ever hit `/v1` per-signal routes. Public input signal types untouched.
- **RECO engine**: HTTP path changes from `/signals/recommendation-bundle` to per-signal paths **but only across release boundaries** — co-deploy server + reco, otherwise RECO calls fail (RECO is external, no graceful fallback available outside the engine's MQ retry).
- **Operators**: drop the bundle schema migration on the next DB deploy.
- **Admins**: the audit log still records per-principal signal reads; the bundle handler is gone but its logger/diagnostics entries vanish — keep an audit backup if needed.

---

## 7. Tests to add / move

- Server `internal-apps.routes.test.ts`: remove bundle-handler test block. Add per-signal tests, one per route:
  - user-PAT caller → 200 own data only, 403 other account
  - reco app-token caller with `accounts:all:read` → 200 any profile
  - app-token without `accounts:all:read` → 403
  - cache invalidation on a write (history cache evicts on `recordPlaybackState`)
- Reco `client.test.ts`: assert per-signal methods issue `Promise.all` and assemble the `GenerateRequest` field shapes.
- Reco `recompute_event_worker.test.ts`: assert the per-signal calls succeed and the assembled request has the expected counts.
- Reco `execute.ts` test: assert a single `batchUpsertRecommendationLists` call carries all four rails with a per-profile idempotency key.

---

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| RECO becomes a higher-fanout client (5 calls instead of 1) | Per-family cache (Phase 3) covers bursty reads; serves all callers (user app can also benefit). |
| Inconsistent identity assumptions between user route and reco route | Single `resolveProfileSignalPrincipal` helper; one ownership-vs-scope branch in one place; covered by tests. |
| Removing bundle breaks WebUI if it relied on bundle-only fields | WebUI's two call sites are the only ones; switch them to per-signal calls. |
| Cache eviction race between writes and reco reads | Existing invalidator already runs inside the same DB transaction on watch writes; re-target it at the new cache. |
| Auth drift (`accounts:all:read` accidentally given to a non-reco app) | Out of scope — already locked by migration `0022`. The `app_source_ownership` for `custom` apps is per-account, not all-account. |
| OpenAPI drift between server specs | Phase 0 (publication/contract) before Phase 4 (delete bundle) keeps schema and handler in lockstep. |

---

## 9. End state (what the system looks like after)

Server:
- one set of per-signal read routes at `/v1` and `/internal/apps/v1`,
- one additional `profile-meta` route at `/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/profile-meta` returning `{ profileName, isKids, language, region, watchDataOrigin }` for reco's `GenerateRequest.profileContext` assembly — reco pulls this in parallel with the watch signal reads. Added a corresponding `ProfileMetaReadResponse` schema to `internal-apps.v1.yaml`,
- taste read/write at `/internal/apps/v1/.../signals/taste`,
- one unified read service (`LocalUserWatchService`) per signal,
- one optional transparent cache,
- one write path (`HomeWriteService.writeHome`) shared by `reco`, `custom`, `fallback`,
- one outbox notifier (`RecommenderNotifier`) fire-and-forget to RECO.

Reco:
- `signal_assembler.ts` issues a `Promise.all` of 8 calls: 6 per-signal reads (history, ratings, watchlist, continue-watching, episodic-follow, taste) + profile-meta + eligibility. It builds the local `RecommendationSignalBundle` from these responses,
- `signal_bundle_mapper.ts` maps BaseItemDto rows into `GenerateRequest` fields (extracts `Tmdb` from `ProviderIds`, converts `Type === 'Series'` to `'tv'`, reads `LastPlayedDate` / `PlayedPercentage` / `Played` / `Rating` / `PlayCount` from `UserData`),
- one `batchUpsertRecommendations` per profile carrying all rails (Phase 6 removed the per-listKey `upsertRecommendationList` loop).

Two repos, one auth framework, one set of route shapes, no bundle-only types or services anywhere.
