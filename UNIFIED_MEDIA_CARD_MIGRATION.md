# Unified ClientMediaCard Migration Plan

## Goal
Every rail / list / shelf surface returns **one shape**: `ClientMediaCard`. Detail & playback endpoints keep `BaseItemDto`. One card model for all clients, no per-surface branching.

## Decisions (locked)

- **Nesting is OK.** `images.poster.medium`, `progress.percent`, `parent.seriesItemId` — both clients already flatten these in their adapters (`CrispyBackendModels.swift`, `CrispyBackendClient.kt`). Keep them; don't flatten.
- **Builders stay.** `buildDetail/Episode/SeasonBaseItemDto` are still used by detail/playback/NextEpisode. Rails just stop emitting their output; they aren't deleted.
- **Episodes grid stays profile-less** (`progress: null`). Resume comes from `/v1/profiles/:profileId/watch/state` and `/v1/profiles/:profileId/watch/states`, which already return `ClientMediaCard` with progress. Verified in `DetailsViewModel.swift` — `getWatchState` → `state.progressPercent`, merged onto the episode grid. No server change for resume.
- **One shared mapper.** `toClientMediaCard(view, opts)` is the single source of truth. Collapses the duplicated logic currently in `HomeHydrator.toClientCard` and `WatchCardHydrator.toClientMediaCard`.
- **NEVER COMPILE THE ANDROID APP.** No Gradle is present in the workspace. The Android client (`/home/aayush/Downloads/crispy-tv/android`) is Kotlin source only — verify changes by reading code, not building. iOS likewise has no build step here; verify by reading `CrispyKit` Swift sources.

---

## Surfaces — complete inventory

### Already `ClientMediaCard` (no change)
| Surface | Location | Status |
|---|---|---|
| Watch lists (continue-watching, history, watchlist, next-up, ratings, episodic-follow, events) | contracts/watch.ts:115-143, :196, :205 | ✅ done |
| Calendar, this-week | calendar.ts, calendar-builder.service.ts, calendar.types.ts | ✅ done |
| Home sections | home-hydrator.service.ts → taste-profile.routes.ts `/v1/profiles/:profileId/home` | ✅ done |
| Watch-state (resume source, per-item + batch) | contracts/watch.ts:184-200, watch.ts:385-403 | ✅ done |

### Migrate to `ClientMediaCard`
| Surface | Current | Code | Contract |
|---|---|---|---|
| Person `knownFor` | BaseItemDto[] | person-detail.service.ts | contracts/metadata.ts:244 |
| `extras` Similar | BaseItemDto[] | metadata-title-extras.builder.ts:131-147 | contracts/metadata.ts:464 |
| `extras` Seasons | BaseItemDto[] | metadata-title-extras.builder.ts:95-100 | contracts/metadata.ts:462 |
| `extras` Collection | BaseItemDtoQueryResult | metadata-title-extras.builder.ts:108-128 | contracts/metadata.ts:467 |
| Series `episodes` Items | BaseItemDto[] | metadata-title-page.service.ts:99-105 | contracts/metadata.ts:334 |
| Title search movies/series (+ AI search, same type) | BaseItemDto[] | title-search.service.ts:142/210 | contracts/metadata.ts:291/295 |
| `cards/batch` | BaseItemDto[] | metadata-card-batch.service.ts:62 | contracts/metadata.ts:319 |

> Note on search: `ai.types.ts:1` defines `AiSearchResponse = MetadataSearchResponse`. Migrating `metadataSearchResponseSchema` covers both `/v1/search/titles` and AI search in one change.

### Keep `BaseItemDto` (not rails)
| Surface | Location |
|---|---|
| Item detail `Item` + `NextEpisode` | contracts/metadata.ts:194-200 |
| Playback resolve `Item`/`Show`/`Season` | contracts/metadata.ts:253-265 |

### Bespoke shapes (decide)
- **Search suggestions** (`searchSuggestionItemSchema`, contracts/metadata.ts:396) → convert to `ClientMediaCard` for purity, or keep as minimal type.
- **Person search results** (`metadataPersonSearchResultSchema`, :269) → **keep**. It's a *person* entity (`kind: 'person_search_result'`), not a media card.

---

## Phase 0 — Shared mapper (no behavior change)

✅ **DONE.**

Created `src/modules/metadata/client-media-card.mapper.ts` — single `toClientMediaCard(view, opts)` source of truth. Home + Watch hydrators refactored to use it.

## Phase 0.5 — Type-aware pipeline (seasons + parent enrichment)

✅ **DONE.**

Made the card pipeline serve all four card types through one path. Two bugs fixed:
- `resolvedMediaType` collapsed `'season'` → `'movie'` (now preserved).
- `MetadataTitleSourceService` loaded season data only for episode identities (now loads `currentSeason` for season identities via new `getSeasons`).

Episode/season cards now carry `seriesTitle` from the loaded show title.

---

## Phase 1 — Contracts + OpenAPI + generated types (REMAINING)

Update `src/http/contracts/metadata.ts`:
- `knownFor` → `clientMediaCardSchema` array
- `Similar`, `Seasons` → `clientMediaCardSchema` arrays
- `Collection` → `clientMediaCardQueryResultSchema`
- `search.movies`, `search.series` → `clientMediaCardSchema` arrays
- `cards/batch` → `clientMediaCardQueryResultSchema`
- **Episodes** — `Items: clientMediaCardSchema[]` + `Creators` + pagination.

Update `openapi/public-app.v1.yaml`: swap all rail `Items`/`items` refs. Keep `BaseItemDto` (detail/playback).

Regenerate: `npm run contract:types && npm run docs:api`.

---

## Phase 1 — Contracts + OpenAPI + generated types

Update `src/http/contracts/metadata.ts`:
- `knownFor` → `clientMediaCardSchema` array
- `Similar`, `Seasons` → `clientMediaCardSchema` arrays
- `Collection` → `clientMediaCardQueryResultSchema`
- `search.movies`, `search.series` → `clientMediaCardSchema` arrays
- `cards/batch` → `clientMediaCardQueryResultSchema`
- **Episodes** — define a *new* `metadataSeriesEpisodesResponseSchema` with `Items: clientMediaCardSchema[]` + keep `Creators: metadataPersonRefViewSchema[]` + pagination. (Can't reuse `clientMediaCardQueryResultSchema` because of the extra `Creators` field.)
- Remove now-unused `baseItemDtoQueryResultSchema` import (only Collection used it).

Keep `baseItemDtoSchema` import (detail/playback still need it).

Update `openapi/public-app.v1.yaml`:
- Swap all `Items`/`items` component refs on rails from `BaseItemDto` → `ClientMediaCard`; Collection → `ClientMediaCardQueryResult`.
- Keep `BaseItemDto` + `BaseItemDtoQueryResult` *components* (detail/playback still reference `BaseItemDto`). Remove `BaseItemDtoQueryResult` only if truly orphaned after Collection moves.
- Add/update the episodes schema with `Items` as `ClientMediaCard` + `Creators`.
- Update the episodes endpoint description (it currently claims Jellyfin `/Shows/{id}/Episodes` parity — that parity is being retired on this endpoint).

Regenerate: `npm run contract:types && npm run docs:api`. The generated `public-app.v1.types.ts` rail response types now emit `ClientMediaCard` instead of `BaseItemDto`.

Update TS type aliases (`metadata-detail.types.ts`):
- `MetadataTitleExtras.Seasons/Similar` → `ClientMediaCard[]`; `.Collection` → `ClientMediaCardQueryResult | null`
- `MetadataPersonDetail.knownFor` → `ClientMediaCard[]`
- `MetadataSearchResult` alias → `ClientMediaCard` (or inline it in `MetadataSearchResponse`)

---

## Phase 2 — Implement rails against the shared mapper

Each rail already resolves contentIds/identities. New path for all of them: resolve `MetadataCardView[]` (via `metadataCardService.buildCardViews` / `buildCardViewsForIdentities`) → map each via `toClientMediaCard(view, {progress: null})`.

- **knownFor** (person-detail.service.ts): replace the `buildDetailBaseItemDto` output with `buildCardViews(identities)` → `toClientMediaCard` (progress null).
- **extras** (metadata-title-extras.builder.ts): Similar/Seasons/Collection — after resolving identities (already at :83-92, :131-146), call `buildCardViews` → map. Drop `buildDetailBaseItemDto`/`buildSeasonBaseItemDto` from this path.
- **search** (title-search.service.ts:142, :210) + **cards/batch** (card-batch.service.ts:62): replace `mediaItemToBaseItemDto(metadataCardToMediaItem(card))` with `toClientMediaCard(card, {progress: null})`. (These already produce a `MetadataCardView`; just stop routing it through BaseItemDto.)
- **suggestions** (optional): convert `searchSuggestionItemSchema` → `clientMediaCardSchema`.

### Episodes — dedicated treatment

**Why it's safe:** the browse grid has no `profileId` (contracts/metadata.ts:78-85) and returns no progress today. The client gets resume from `getWatchState` / `getWatchStates` (`watch.state` endpoint, already `ClientMediaCard` with progress — contracts/watch.ts:184-200). Migrating the grid to `ClientMediaCard` with `progress: null` loses nothing.

**Implementation** (metadata-title-page.service.ts:99-105):
1. Episodes already resolve contentIds/identities. Call `metadataCardService.buildCardViews(episodeIdentities, language)` → `MetadataCardView[]`.
2. Map each via `toClientMediaCard(view, {progress: null})`.
3. Result: episode cards with `mediaType: 'episode'`, `parent: { seriesItemId, seasonItemId, seasonNumber, episodeNumber }`, `images.still`, title, overview. Drop `buildEpisodeBaseItemDto` from this path.
4. Response keeps `Creators` (show-level people) alongside the `Items` clientMediaCardSchema[] and pagination.

**Verified the data is available:** `MetadataCardView` carries `still` (metadata-card.types.ts:14), `seriesItemId`/`seasonItemId` (50-51), `seasonNumber`/`episodeNumber` (54-55) — proven because `HomeHydrator` (home-hydrator.service.ts:134-149) already renders episode cards with exactly these.

**No `profileId` on the episodes route.** The client fetches resume separately via watch-state and merges in `DetailsViewModel`. If you later want resume dots *directly* on the grid, add an optional `profileId` query param + compute progress from `UserData` — but that's a separate, optional enhancement. Keep the grid cacheable and profile-less for now.

---

## Phase 3 — Tests

Route/integration tests to update (assert `itemId`/`title`/`images` instead of `Id`/`Name`/`ImageTags`):
- src/http/routes/metadata.test.ts (extras Similar/Seasons, episodes + Creators)
- src/modules/search/title-search.service.test.ts
- metadata-card-batch.service.test.ts
- person knownFor test
- ai search test
- watch tests (already `ClientMediaCard` — verify unchanged)

`metadata-detail.builders.test.ts`: keep — builders are retained for detail/playback.

---

## Phase 4 — Verification

```
npm run typecheck
npm run contract:lint
npm run contract:types && npm run docs:api
npm run guard:jellyfin-legacy-keys && npm run guard:retired-modules
node --test (affected suites)
```

Pre-existing unrelated failures to exclude from this work: commit 626b808 `w780→w1280` in `metadata-detail.builders.test.ts`; `contract:drift` on admin-ops homescreen paths.

---

## Phase 5 — Client coordination (ships together)

This is a breaking rename (`Id→itemId`, `Name→title`, `ImageTags→images`, `UserData→progress`). Both clients flatten the new shape already, so once the server unifies:

**iOS** (`/home/aayush/Downloads/crispy-tv/ios/CrispyKit/Sources/CrispyKit/MediaCard.swift`) — delete:
- `SearchMediaItem` + `parseSearchMediaItem` decoder (BaseItemDto→camelCase)
- `MediaCard.from(SearchMediaItem)` adapter
- `DetailsViewModel.makeCard(_: MetadataCard)` adapter (extras/episodes become ClientMediaCard)
- `from(HomeCatalogItem)` can collapse into `from(ClientMediaCard)` later

**Android** (`/home/aayush/Downloads/crispy-tv/android/`) — delete:
- search `parseSearchMediaItem` / `toCatalogItem` adapters
- route the unified surfaces through the single `CatalogItem` path
- **DO NOT RUN GRADLE.** No Gradle is present. Verify by reading Kotlin sources only.

Recommend an API version bump or a short deprecation window coordinated with the client release.

---

## Sequencing (PRs)

1. ~~**Phase 0** — shared mapper + refactor HomeHydrator/WatchCardHydrator.~~ ✅ DONE
2. **Phase 1** — contracts + OpenAPI + generated types (the shape switch): metadata.ts rails + episodes schema.
3. **Phase 2** — implement rails one PR each (knownFor, search[+AI], extras, episodes, cards/batch, suggestions-optional). Calendar is already done.
4. **Phase 3** — tests alongside each PR.
5. **Phase 4-5** — verification + client coordination.
