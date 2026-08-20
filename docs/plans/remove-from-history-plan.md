# Plan: Remove from Watch History

## Goal
Add a user-facing "Remove from history" capability. Removing an item **permanently deletes** its
watch-history entry for the profile. Progress is intentionally discarded (the user does not care
about resume state when clearing history).

- Single item (movie, episode, or a specific show+season+episode): delete that one row.
- Season or show: **cascade** — delete every child episode history row (and the season/show row
  itself), exactly like Jellyfin's `MarkPlayed` recursion over children.

## Current state (evidence from code, no assumptions)

- **History is derived, not stored.** `LocalUserWatchService.listHistoryPage`
  (`src/modules/integrations/local-user-watch.service.ts:335`) selects from
  `user_state.watch_state` where `last_played_at IS NOT NULL`, ordered desc. No separate history
  table exists. Removing = make the row not appear (delete/null it).
- **`watch_state` is keyed per `(profile_id, item_id)`.** One row per item (movie, episode, season,
  show). Columns include `played`, `play_count`, `last_played_at`, `position_seconds`, `rating`,
  `is_favorite` (`local-user-watch.service.ts:703-713`).
- **Existing single-row mutations to mirror** (all `UPDATE`/`INSERT ... ON CONFLICT` on one
  `item_id`, then `publishWatchChanged(..., 'continue_watching', { force: true })`):
  - `dismissContinueWatching` (`:647`) — `UPDATE ... SET position_seconds = 0`.
  - `deleteRating` (`:691`) / `deleteListItem` (`:669`) — `UPDATE ... SET col = NULL`.
  - `markWatched` (`:701`) / `unmarkWatched` (`:718`) — single `item_id` write.
- **Route layer does NOT cascade today.** `mark-watched` route
  (`src/http/routes/watch.ts:376-405`) only narrows `show + seasonNumber + episodeNumber` down to a
  *single* episode (`:389-394`). It does **not** expand a whole season/show into child rows — it
  writes the level it was given. This gap must be closed for season/show history removal.
- **Existing DELETE routes to mirror** (`watch.ts`):
  - `DELETE /watch/continue-watching/:id` (`:231`) — uses
    `watchContinueWatchingDismissRouteSchema` + `params.id` (publicItemId), returns
    `mutation({ accepted: true, mode: 'synchronous' })`.
  - `DELETE /watch/watchlist/:itemId` (`:453`) and `DELETE /watch/rating/:itemId` (`:493`) — use
    `watchItemIdParamsRouteSchema`.
- **Child enumeration does NOT exist yet.** `content_item_relationships`
  (`src/modules/identity/content-identity.repo.ts:25`) has `relationship_type` of `'series'`
  (episode→show) and `'season'` (episode→season). There is `findParentRelationship` (child→parent,
  `:294`) but **no "list children by parent"** method. A new query is required.
- **OpenAPI is generated.** `openapi/public-app.v1.yaml` is the source of truth;
  `npm run contract:types` regenerates `openapi/generated/public-app.v1.types.ts`. Also available:
  `contract:lint`, `contract:drift`, `docs:api`. The continue-watching dismiss DELETE op is at
  `openapi/public-app.v1.yaml:1852-1893` — direct template to copy.
- **Invalidation publisher** `publishWatchChanged`
  (`src/modules/watch/watch-change.publisher.ts:22`) only supports `kind: 'continue_watching'`
  (type `WatchChangeKind`, `:7`). No `'history'` kind exists.
- **Route registration** is centralized in `src/http/app.ts:235`
  (`await registerWatchRoutes(app, { profilePinService })`); no new wiring needed.

## Implementation steps

### 1. Child-enumeration query (prerequisite)
In `ContentIdentityRepository` (`src/modules/identity/content-identity.repo.ts`), add:
`findChildContentIds(client, parentContentId: string, relationshipType: 'series' | 'season'): Promise<string[]>`
mirroring `findParentRelationship` (`:294`) but selecting `child_content_id` where
`parent_content_id = $1 AND relationship_type = $2`. Used to collect episode ids under a season/show.

### 2. Service method — `LocalUserWatchService`
Add `deleteHistory(params)` (`src/modules/integrations/local-user-watch.service.ts`):

- Params (mirror `MarkWatchedParams`, `:67`): `accountId, profileId, itemId, titleItemId,
  mediaType: 'movie' | 'show' | 'season' | 'episode', seasonNumber?, episodeNumber?`.
- Resolve target `item_id`s to delete:
  - `movie` / `episode` → `[playableItemId]`.
  - `show` + `seasonNumber` + `episodeNumber` → resolve to the single episode via the existing
    `resolveEpisodePlayableItemId` (`:620`), like the mark-watched route (`:389-394`).
  - `season` (resolved season content id) → `[seasonId]` **plus** all episode ids from
    `findChildContentIds(seasonId, 'season')`.
  - `show` → `[showId]` **plus** all episode ids from `findChildContentIds(showId, 'series')`
    (and optionally season rows via `findChildContentIds(showId, 'season')` — confirm desired
    scope; episodes are what appear in history, so at minimum delete episodes + the show row).
- Delete in one statement:
  `DELETE FROM user_state.watch_state WHERE profile_id = $1::uuid AND item_id = ANY($2::uuid[])`.
- After delete, call `publishWatchChanged(accountId, profileId, 'continue_watching', { force: true })`
  to match every other watch mutation's invalidation behavior.
- Idempotent: deleting an already-absent item is a no-op (DELETE with no match → 200).

### 3. Route — `src/http/routes/watch.ts`
Add `DELETE /v1/profiles/:profileId/watch/history/:id` (place next to the continue-watching dismiss
route, `:231`), mirroring it but resolving `mediaType` like the mark-watched route (`:384-394`):
- `requireAuth` + `requireUserSessionActor` + `assertProfileUnlocked`.
- `assertPublicItemId(params.id)`; resolve `{ publicTitleItemId, mediaType }` via
  `contentIdentityService.resolveTitleItemIdForPlayableItemId` (returns `mediaType`, `:478`).
- Optionally accept `?seasonNumber=` + `?episodeNumber=` query params to target a specific episode
  inside a show (mirrors mark-watched body semantics; query is cleaner for DELETE).
- Call `localUserWatchService.deleteHistory({ accountId, profileId, itemId, titleItemId,
  mediaType, seasonNumber, episodeNumber })`.
- Return `mutation({ accepted: true, mode: 'synchronous' })`.

### 4. Contracts — `src/http/contracts/watch.ts`
- Add `WatchHistoryDeleteQuery` type (optional `seasonNumber?`, `episodeNumber?`).
- Add `watchHistoryItemDeleteRouteSchema` = `withDefaultErrorResponses({ params:
  profileIdAndItemIdParamsSchema, querystring: { type:'object', additionalProperties:false,
  properties: { seasonNumber: nullableNumberSchema, episodeNumber: nullableNumberSchema } } })`.
  (Reuse `profileIdAndItemIdParamsSchema` like `watchItemIdParamsRouteSchema`.)

### 5. OpenAPI spec — `openapi/public-app.v1.yaml`
Add a `delete` operation on a new path `/v1/profiles/{profileId}/watch/history/{id}` (copy the
continue-watching dismiss op at `:1852-1893`):
- `operationId: deleteV1ProfilesProfileIdWatchHistoryId`
- `summary: Remove item from watch history.`
- path params `profileId` + `id` (`$ref: "#/components/schemas/PublicItemId"`)
- optional query params `seasonNumber`, `episodeNumber`
- `200` → `WatchActionResponseEnvelope`; include the standard error responses (400/401/403/404/409/
  429/500).

### 6. Regenerate & validate
- `npm run contract:types` (regenerates `openapi/generated/public-app.v1.types.ts`, now including
  `deleteV1ProfilesProfileIdWatchHistoryId`).
- `npm run contract:lint`, `npm run contract:drift`, `npm run docs:api`.
- `npm run typecheck`, `npm run test`.

### 7. Tests
Mirror existing patterns in `src/http/routes/watch.test.ts` and
`src/modules/integrations/local-user-watch.service.test.ts`:
- Deleting a movie/episode row removes it from `listHistoryPage`.
- Deleting a season cascades to (removes) its episode history rows.
- Deleting a show cascades to all its episode history rows.
- `show + season + episode` targets only that episode.
- Idempotent: deleting an absent item returns 200 and leaves history unchanged.

### 8. Docs
- `npm run docs:api` regenerates `docs/api/generated`.
- Add a one-line note in `spec.md` / `architecture.md` (history section, ~`architecture.md:34,180`)
  that history entries are user-removable via `DELETE /watch/history/{id}` and that removal is
  cascade for seasons/shows.
- No `AGENT.md` module guard change needed — this extends the existing Watch surface, not a new
  module.

## Decisions / open questions
1. **Invalidation kind (RESOLVED):** Do **not** reuse `'continue_watching'`. Expanded
   `WatchChangeKind` to `'continue_watching' | 'history'` in
   `src/modules/watch/watch-change.publisher.ts`. `deleteHistory` publishes the dedicated
   `'history'` kind. The OpenAPI `/watch/stream` description now enumerates both `kind` values and
   notes that a `history` event should also trigger a continue-watching refetch (because deleting
   the underlying `watch_state` row drops the item from continue-watching too). The server-side
   contract is uniform and explicit; the client must refetch history (and continue-watching) on a
   `history` event.
2. **DELETE body vs query for season/episode:** use query params (`?seasonNumber=&episodeNumber=`),
   since DELETE with a JSON body is unconventional and the route already parses `params.id`.
3. **Cascade scope for a show:** delete all child episode rows + the show row (episodes are what
   surface in history). Season rows under the show may also be cleared for completeness — confirm.
4. **Recommender signaling:** verify whether existing watch writes call `recommenderNotifier.
   notifyRecompute(..., 'watch_history_changed')` (defined `src/modules/recommender-notifier/
   recommender-notifier.ts:6`); if so, history deletion should trigger it too for consistency.
   (Note: `markWatched` currently only calls `publishWatchChanged`, so alignment may be optional.)
