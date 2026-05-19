# Identity v2 Migration Plan

Status: draft implementation plan for the opaque item-id migration described in `identity-v2-spec.md`.

## Goal

Move Crispy public media identity from TMDB-shaped media keys to Jellyfin-style opaque item ids:

- Public `BaseItemDto.Id` is a Crispy item id.
- Public `SeriesId` and `SeasonId` are parent Crispy item ids.
- External provider ids live only in `ProviderIds` or server-side provider refs.
- Old media keys remain provider locators for compatibility and discovery only.

The server already has the target identity backbone in `content_items` and `content_provider_refs`. The migration should use those tables instead of introducing a parallel id system.

## Non-goals

- Do not remove TMDB metadata support in the first migration. TMDB remains a metadata provider during phase 1.
- Do not require clients to understand provider refs.
- Do not make Android or iOS parse UUIDs, media keys, season numbers, or provider ids to infer identity.
- Do not change active contract semantics until the bumped fixtures and runners are ready.

## Invariants

These must be true for every endpoint once it is switched to Identity v2:

- `Id` never contains `:`.
- `SeriesId` and `SeasonId` are either `null` or opaque item ids.
- `SeriesId` is never a raw TMDB id.
- `SeasonId` is never a season number or `season:tmdb:*` key.
- `UserData.ItemId` matches the public item represented by the DTO.
- User-state writes store item ids, not provider locators.
- Compatibility routes may accept media keys, but their responses still emit item ids.

## Phase 0: lock current behavior and add safety tests

Purpose: make the current bug impossible to reintroduce silently while the larger migration is built.

### Server

Add tests around current public DTO emission and media-key compatibility:

- Episode DTOs must not emit numeric-only `SeriesId` after the server-side mapper is fixed.
- `/v1/metadata/titles/:mediaKey` must reject raw ids such as `1396` with a clear compatibility error.
- Existing media-key routes still resolve current fixtures.

Touchpoints:

- `src/modules/metadata/media-item.mapper.ts`
- `src/modules/integrations/watch-read.mapper.ts`
- `src/modules/identity/media-key.ts`

### Android

Add defensive tests or assertions for the homescreen episode path:

- Continue-watching episode click must never pass a raw numeric title route id.
- Calendar episode click must never pass a raw numeric title route id.

Touchpoints in app repo:

- `android/app/src/main/java/com/crispy/tv/ui/navigation/HomeNavGraph.kt`
- `android/app/src/main/java/com/crispy/tv/watchhistory/BackendWatchHistoryService.kt`
- `android/app/src/main/java/com/crispy/tv/home/CalendarService.kt`

## Phase 1: server identity boundary

Purpose: make `ContentIdentityService` the only boundary between provider locators and item ids.

### 1.1 Add explicit identity resolver APIs

Create or expose helpers with clear names:

- `resolveItemIdFromProviderLocator(locator)`
- `resolveItemIdFromMediaKey(mediaKey)` as compatibility wrapper
- `resolveProviderRefsForItemId(itemId)`
- `resolveTitleItemIdForPlayableItemId(itemId)`
- `resolveParentItemIdsForEpisode(itemId)`

Expected implementation base:

- `src/modules/identity/content-identity.service.ts`
- `src/modules/identity/content-identity.repo.ts`
- `src/modules/identity/media-key.ts`

Rules:

- `parseMediaKey` remains, but rename its conceptual use to provider-locator parsing.
- No new code outside the identity module should parse media keys for parent relationships.
- `resolveContentReference` should return provider refs and item metadata without assuming TMDB is always the authority.
- `selectAuthorityRef` may prefer TMDB during phase 1, but it must have a defined fallback path for non-TMDB refs.

### 1.2 Materialize parent identities

For episode materialization, ensure the following exist or can be resolved:

- episode item id
- parent series item id
- parent season item id when season identity is available
- provider refs for all materialized items

Required behavior:

- A TMDB episode locator such as `episode:tmdb:1396:1:1` materializes an episode item.
- The episode item carries a relationship to the series item and, when available, the season item.
- Parent ids are available to mappers without reconstructing `show:tmdb:*` strings.

Potential schema check:

- If `content_provider_refs.metadata` is the only relationship storage, verify it is sufficient and indexed enough for parent lookups.
- If not, add a small relationship table such as `content_item_relationships(child_content_id, relationship_type, parent_content_id)` before migrating user state.

## Phase 2: item-id routes and compatibility routes

Purpose: add the new route surface before changing clients.

### 2.1 Add preferred metadata routes

Add:

```text
GET /v1/metadata/items/:itemId
GET /v1/metadata/items/:itemId/extras
GET /v1/profiles/:profileId/metadata/items/:itemId/reviews
GET /v1/profiles/:profileId/metadata/items/:itemId/ratings
```

Behavior:

1. Validate `:itemId` as opaque item id.
2. Resolve item id to content item and provider refs.
3. Use provider-specific metadata services internally.
4. Emit `BaseItemDto` with item ids in `Id`, `SeriesId`, and `SeasonId`.

Touchpoints:

- `src/http/routes/metadata.ts`
- `src/modules/metadata/metadata-route-identity.ts`
- `src/modules/metadata/metadata-title-page.service.ts`

### 2.2 Keep media-key routes as compatibility routes

Existing routes remain temporarily:

```text
GET /v1/metadata/titles/:mediaKey
GET /v1/metadata/titles/:mediaKey/extras
```

Required behavior:

1. Parse `:mediaKey` as provider locator.
2. Materialize or resolve an item id through `ContentIdentityService`.
3. Delegate to the item-id route path internally.
4. Return item-id DTOs after the endpoint is switched to Identity v2.

Do not let compatibility routes return media-key `Id` values after the route is marked v2.

### 2.3 Add item-id playback resolve

Add:

```text
GET /v1/playback/resolve?itemId=:itemId
```

Behavior:

- Resolve item id to provider refs.
- If episode, resolve parent series and season.
- Choose the provider locator needed by the playback provider internally.
- Write watch state using item ids.

Compatibility inputs remain:

```text
GET /v1/playback/resolve?mediaKey=episode:tmdb:1396:1:1
GET /v1/playback/resolve?tmdbId=1396&mediaType=episode&seasonNumber=1&episodeNumber=1
```

But compatibility inputs must materialize item ids before any user-state write.

## Phase 3: server DTO mappers emit item ids

Purpose: switch public response shapes to opaque ids.

### 3.1 Metadata item mapper

Update `src/modules/metadata/media-item.mapper.ts`:

- `BaseItemDto.Id = itemId`
- `BaseItemDto.SeriesId = parent series item id`
- `BaseItemDto.SeasonId = parent season item id when available`
- `ProviderIds.Tmdb = tmdb provider ref external id`
- No raw TMDB ids in parent id fields

Current bad behavior to remove:

- `SeriesId: item.showTmdbId !== null ? String(item.showTmdbId) : null`

### 3.2 Watch/read mappers

Update `src/modules/integrations/watch-read.mapper.ts`:

- Stop parsing persisted identity values with `parseMediaKey` after migration.
- Treat row identity fields as item ids.
- Resolve item ids to metadata and provider refs when rendering DTOs.
- Episode continue-watching DTO uses episode item id in `Id` and series item id in `SeriesId`.

Current bad behavior to remove:

- `SeriesId: isEpisode ? String(parsed.showTmdbId ?? '') : null`
- `canonicalTitleMediaKey(parseMediaKey(mediaKey))`

### 3.3 Metadata card cache

Update `src/modules/watch/watch-metadata-enrichment.service.ts`:

- Cache by item id.
- Parent lookup uses identity relationships, not episode media-key parsing.
- Cache values preserve item-id `Id`, `SeriesId`, and `SeasonId`.

Current bad behavior to remove:

- `showKeyFromEpisodeKey`
- constructing `show:tmdb:*` as a parent key

### 3.4 Calendar builder

Update `src/modules/calendar/calendar-builder.service.ts`:

- Candidate shows are item ids.
- Episode calendar items emit episode item id in `Id`.
- `SeriesId` is series item id.
- `SeasonId` is season item id when materialized.
- No calendar logic parses media keys to infer show ids.

## Phase 4: user-state data migration

Purpose: migrate persisted watch/list/rating/cache identity values from media keys to item ids.

### 4.1 Migration strategy

Use an expand-migrate-contract approach.

Expand:

- Add item-id columns beside existing media-key columns.
- Backfill item-id columns by parsing old media keys as provider locators and resolving through `ContentIdentityService`.
- Add indexes on new item-id columns.

Dual-write:

- Server writes both old media-key columns and new item-id columns for one release window.
- Reads prefer item-id columns and fall back to old media-key columns only when item id is absent.

Contract:

- Stop writing old media-key columns.
- Rename item-id columns or leave compatibility aliases if external migrations are risky.
- Remove media-key parsing from read paths.

### 4.2 Tables and columns

Migrate these identities:

- `user_state.watch_events.media_key` -> `item_id`
- `user_state.watch_events.title_media_key` -> `title_item_id`
- `user_state.playback_progress.title_media_key` -> `title_item_id`
- `user_state.playback_progress.playable_media_key` -> `playable_item_id`
- `user_state.media_watch_summary.media_key` -> `item_id`
- `user_state.media_watch_summary.title_media_key` -> `title_item_id`
- `user_state.profile_list_items.media_key` -> `item_id`
- `user_state.profile_ratings.media_key` -> `item_id`
- `read_model.profile_episodic_follow_state.title_media_key` -> `title_item_id`
- `read_model.profile_episodic_follow_state.next_episode_media_key` -> `next_episode_item_id`
- `watch_media_card_cache.media_key` -> `item_id`

Known schema origin:

- `migrations/0065_rebuild_local_user_tables.sql`
- `migrations/0062_metadata_language_support.sql`

### 4.3 Backfill requirements

For each old media key:

- Movie media key resolves to movie item id.
- Show media key resolves to series item id.
- Season media key resolves to season item id and parent series item id.
- Episode media key resolves to episode item id and parent series item id.

For each row with both title and playable identity:

- If playable is movie: `title_item_id = playable_item_id`.
- If playable is episode: `title_item_id = parent series item id`.

Rows that cannot be resolved:

- Keep old media-key value for compatibility fallback.
- Mark migration error details in a temporary audit table.
- Do not silently drop watch progress, ratings, or list entries.

### 4.4 Rollback

Keep old media-key columns through at least one release window.

Rollback path:

- Switch reads back to old media-key columns.
- Continue accepting compatibility routes.
- Keep item-id writes harmless if old clients are still active.

Do not drop old columns until:

- Android and iOS clients use item routes.
- Contract fixtures are bumped and passing.
- Production data audit shows no unresolved rows.

## Phase 5: Android migration

Purpose: make the client treat backend `Id` as opaque item id.

### 5.1 Rename semantics

Update data models gradually:

- `MediaItem.mediaKey` -> `itemId` or keep field name temporarily with item-id semantics.
- `CanonicalContinueWatchingItem.titleMediaKey` -> `titleItemId`.
- `CanonicalContinueWatchingItem.playbackMediaKey` -> `playableItemId`.
- Calendar models should use `itemId`, `seriesItemId`, and `playableItemId` naming when touched.

Touchpoints in app repo:

- `android/app/src/main/java/com/crispy/tv/backend/CrispyBackendClient.kt`
- `android/app/src/main/java/com/crispy/tv/backend/CrispyBackendParsers.kt`
- `android/player/src/main/java/com/crispy/tv/player/WatchHistoryService.kt`
- `android/app/src/main/java/com/crispy/tv/watchhistory/BackendWatchHistoryService.kt`
- `android/app/src/main/java/com/crispy/tv/home/CalendarService.kt`

### 5.2 Stop deriving TMDB ids from parent ids

Remove patterns like:

- `item.seriesId?.trim()?.toIntOrNull()`
- formatting `episode:tmdb:{showId}:{season}:{episode}` from `SeriesId`
- detecting title type by splitting `Id`

Replacement rules:

- Use `ProviderIds.Tmdb` only when a TMDB id is needed for display or provider-specific compatibility.
- Use item-id routes for details/watchlist/ratings/playback.
- Ask backend to resolve playback for item id instead of constructing provider locators in the app.

### 5.3 Navigation updates

Update homescreen navigation:

- Continue watching details route uses `titleItemId`.
- Continue watching playback/highlight uses `playableItemId`.
- Calendar details route uses `SeriesId` for episodes.
- Calendar playback/highlight uses episode `Id`.
- Hero/catalog/recommendation clicks pass item ids.

Touchpoints in app repo:

- `android/app/src/main/java/com/crispy/tv/ui/navigation/HomeNavGraph.kt`
- Details route arguments and backend calls currently named `mediaKey`
- Stream selector and playback resolve inputs

### 5.4 API client route updates

Add methods for:

- `GET /v1/metadata/items/:itemId`
- `GET /v1/metadata/items/:itemId/extras`
- `GET /v1/playback/resolve?itemId=:itemId`
- item-id watchlist/rating/continue-watching routes

Keep old media-key methods only for compatibility or fixture migration.

## Phase 6: contracts and iOS runner

Purpose: make the contract suites enforce the new public identity shape.

### 6.1 Bump suites

Update these suite versions:

- `media_state_contract`: v5
- `watch_collections_contract`: v4
- `calendar_contract`: v4
- `home_catalogs`: v6
- `search_ranking_and_dedup`: v5

### 6.2 Fixture changes

For every affected fixture:

- Replace `Id: movie:tmdb:*` with opaque item id.
- Replace `Id: show:tmdb:*` with opaque item id.
- Replace `Id: episode:tmdb:*` with opaque item id.
- Replace `SeriesId: 1396` or `SeriesId: show:tmdb:*` with opaque series item id.
- Replace `SeasonId: season:tmdb:*` with opaque season item id.
- Preserve `ProviderIds.Tmdb` where known.
- Add `ProviderIds.Imdb` and `ProviderIds.Tvdb` only when the fixture needs them.
- Rename normalized expected `media_key` fields to `item_id` where they represent public identity.

### 6.3 Negative fixtures

Add fixtures proving invalid v2 public identity is rejected:

- `BaseItemDto.Id` containing `:`.
- Episode `SeriesId` equal to raw `1396`.
- Episode `SeriesId` equal to `show:tmdb:1396`.
- Episode `SeasonId` equal to raw `1`.
- Episode `SeasonId` equal to `season:tmdb:1396:1`.
- Missing `ProviderIds.Tmdb` does not break public identity when an item id exists.

### 6.4 Android contract runner

Update Kotlin contract code:

- `MediaStateContract` normalizes `Id` as `item_id`, not `media_key`.
- `BaseItemDto` validation rejects provider-locator ids in public fields for v5.
- Watch/calendar contract runners assert parent id shape.
- Search ranking output uses opaque `item_key` for title results.

Touchpoints in app repo:

- `android/core-domain/src/main/kotlin/com/crispy/tv/domain/media/MediaStateContract.kt`
- `android/contract-tests/src/test/kotlin/com/crispy/tv/contracts/*`

### 6.5 Swift contract runner

Update Swift contract code:

- Parse `Id` as opaque item id.
- Stop naming normalized public identity `mediaKey` in v2/v5 contract output.
- Add parent id validation matching Android.
- Keep fixture parsing strict with descriptive errors.

Touchpoints in app repo:

- `ios/ContractRunner/Sources/ContractRunner/MediaStateContract.swift`
- `ios/ContractRunner/Sources/ContractRunner/PublicPersonalMediaContract.swift`

### 6.6 Active app SPEC update

When fixtures are bumped, update `contracts/SPEC.md` in the app repo:

- Replace the active public `mediaKey` section with Identity v2 item-id rules.
- Move old media-key syntax to a compatibility/provider-locator section.
- Add the Identity v2 migration note under breaking changes.
- Keep suite versions and route rules in lockstep with fixtures.

Do not update active semantics in app `SPEC.md` before implementation starts unless the text clearly labels Identity v2 as draft.

## Phase 7: search, recommendations, and home catalogs

Purpose: remove provider-route keys from discovery surfaces.

### Search

Update search normalization:

- Title results materialize item ids before being returned.
- `item_key` for title results is item id backed.
- Person route ids may remain separate, but should become opaque once person identity is materialized.
- Dedupe may still use provider refs internally.

Touchpoints:

- Search contract fixtures and runners.
- Server search response mappers.
- Android search result route handling.

### Recommendations and home catalogs

Update recommendation/catalog surfaces:

- Hero ids are item ids.
- Rail/catalog item ids are item ids.
- Provider ids stay in metadata only.
- Do not let clients construct route ids from TMDB fields.

Touchpoints:

- `android/app/src/main/java/com/crispy/tv/home/RecommendationCatalogService.kt` in app repo
- home catalog contract fixtures and runners
- server home/catalog mappers

## Phase 8: release sequencing

Recommended order:

1. Add server item-id routes while preserving media-key routes.
2. Add server dual-write and read fallback for user-state item ids.
3. Switch server DTO mappers for selected v2 endpoints to emit item ids.
4. Add Android support for item-id routes behind compatibility-safe code paths.
5. Bump contract fixtures and runners.
6. Switch Android default calls to item-id routes.
7. Update iOS contract runner and placeholder clients.
8. Audit production data for unresolved old media-key rows.
9. Stop writing old media-key columns.
10. Remove old media-key read fallback after old clients are no longer supported.

## Verification checklist

### Contract validation

Run from app repo:

```sh
python3 scripts/validate_contracts.py
gradle :android:contract-tests:test
swift test --package-path ios/ContractRunner
```

### Server tests

Run server unit/integration tests that cover:

- identity materialization
- metadata item routes
- media-key compatibility routes
- watch writes and reads
- continue-watching responses
- calendar responses
- playback resolve

### Manual smoke tests

Before rollout, verify:

- Open movie from home.
- Open show from home.
- Open episode from continue watching with auto-open enabled.
- Open episode from calendar/this-week.
- Add and remove watchlist item.
- Add and remove rating.
- Resume playback and confirm progress persists.
- Dismiss continue-watching item.
- Search a movie/show and open details.
- Resolve playback for item without relying on TMDB in the route.

### Data audit queries

Add temporary production audit queries for v2 endpoints:

- Count public DTO ids containing `:`.
- Count public `SeriesId` values matching numeric-only strings.
- Count public `SeasonId` values matching numeric-only strings.
- Count user-state rows with unresolved old media-key values.
- Count watch/cache rows where playable item has no title item.

## Rollback plan

Rollback must remain possible until old media-key columns are dropped.

Server rollback:

- Route clients back to `/v1/metadata/titles/:mediaKey` compatibility paths.
- Read old media-key columns for user-state.
- Keep item-id columns populated but non-authoritative.

Client rollback:

- Android can keep compatibility methods for media-key routes until migration is complete.
- Do not delete media-key route code in the same release that first switches to item routes.

Data rollback:

- Do not mutate old media-key columns during backfill.
- Do not drop old media-key indexes until production audits pass.
- Keep an audit table for unresolved or ambiguous backfill rows.

## Open decisions

- Whether parent relationships should stay in `content_provider_refs.metadata` or move to a dedicated relationship table.
- Whether public item ids should expose raw UUID strings or a prefixed opaque form such as `ci_<uuid>`.
- How long compatibility media-key routes must remain for old clients.
- Whether season items should always be materialized before episode DTOs are emitted, or only when the metadata provider supplies season identity.
- How to represent provider refs for episode-level TMDB identity when TMDB does not expose a stable episode id in the same way as titles.

## Acceptance criteria

Identity v2 migration is complete when:

- Active contracts reject media keys and raw provider ids in public `Id`, `SeriesId`, and `SeasonId` fields.
- Server item-id routes cover metadata, extras, ratings, reviews, watchlist, continue-watching, and playback.
- Android routes all home, details, calendar, watch, and playback flows by item id.
- User-state writes persist item ids.
- Old media-key routes are compatibility-only.
- TMDB can be absent from a supported item's `ProviderIds` without breaking public route identity.
