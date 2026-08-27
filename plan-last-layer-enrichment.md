# Plan — Last-Layer Enrichment (Split Brains Fix)

> Status: **Draft — audit + plan only, no code**.  
> Goal: internals = `itemId` only, enrichment = single boundary layer before the client.

---

## 0) Principle

```
Brain 1 — Internal (IDs + per-user state)
  itemId (content_items.id, UUID, public as 32-char hex)
  mediaType ('movie' | 'show' | 'season' | 'episode')
  seasonNumber / episodeNumber (only for episode identity)
  per-user state: position_seconds, duration_seconds, played, is_favorite, rating, last_played_at
  identity helpers: provider / providerId / showTmdbId (only to resolve identity, not to display)
  pure policy inputs: seasonNumber/episodeNumber/airDate (for next-episode schedule)

Brain 2 — Boundary (hydration → ClientMediaCard)
  title, overview, tagline, genres, vote_average, runtime
  poster / backdrop / logo / still  (tmdb_images)
  translations (tmdb_title_translations)
  parent.seriesItemId / seasonItemId (content_item_relationships)
  Hydrated via MetadataCardService.buildCardViews*() → toClientMediaCard()
  Called only in route handlers, never inside domain services.
```

**`progress` bridge:** `watch_state` stores per-user state (Brain 1). At the boundary the route reads that map and overlays `ClientMediaCard.progress`. Title part is shared & cacheable by identity; progress never is.

**Policy nuance:** `airDate` is needed for `nextReleasedEpisodeAfter` policy — read as a scalar via a small indexed query, not as a full card. `episode title` (`tmdb_tv_episodes.name`) is NOT policy — it is display and must not be read inside the service.

---

## 1) Current split-brains map

| Surface | Today returns | Hydrated where | Correct boundary? |
|---|---|---|---|
| `GET /v1/.../watch/continue-watching` | `BaseItemDto[]` → `watchCardHydrator.hydrateItems(BaseItemDto[])` | `watch-read.mapper.ts` fuses + `watch-card-hydrator.ts` reverses | **No** — DTO in, DTO out |
| `GET /v1/.../watch/history|watchlist|ratings|next-up|state` | same `BaseItemDto[]` path | same | **No** |
| `GET /v1/.../watch/episodic-follow` | `EpisodicFollowView { show: MetadataCardView, nextEpisodeTitle }` | `episodic-follow.service.ts:99,331` inside service | **No** |
| `GET /v1/.../watch/stream` | SSE `watch_changed` events | pure IDs | **Yes** |
| `POST /v1/.../watch/events, mark-watched, etc.` | `mutation` | IDs only | **Yes** |
| `GET /v1/home` (via `home-hydrator`) | `ClientHomeSection { items: ClientMediaCard[] }` | `home-hydrator.service.ts:36` at route boundary | **Yes** (reference) |
| `GET /v1/search/titles` | `ClientMediaCard[]` inside service | `title-search.service.ts:135,209` inside service | **No** (but service is search, still wrong layer) |
| `GET /v1/persons/:id` known-for | `ClientMediaCard[]` inside service | `person-detail.service.ts:92` inside service | **No** |
| `GET /v1/metadata/items/:id/extras` seasons/similar/collection | `ClientMediaCard[]` inside builder | `metadata-title-extras.builder.ts:74,130,158` inside builder | **No** |

---

## 2) Violations — file:line

### P0 — Root cause (fix first)

#### 2.1 `src/modules/integrations/local-user-watch.service.ts` — watch read path synthesizes an enriched DTO
- **L123 `WATCH_ITEM_CONTENT_JOIN`** joins `tmdb_titles` + `tmdb_tv_episodes` inside watch to compute `duration_seconds`/`progress_bps` L174-177. Metadata runtime leaked into watch.
- **L186 `listContinueWatchingPage`**, **L220 `listNextUpPage`**, **L297 `listWatchlistPage`**, **L321 `listRatingsPage`**, **L344 `listHistoryPage`**, **L411 `getStates`** all return `PaginatedWatchCollection<BaseItemDto>` — a Jellyfin-shaped `Id/Type/Name/ProviderIds/ParentIndexNumber/SeriesName/ImageTags` DTO built from joins.
- **L502 `recordPlaybackState`** → `resolveCanonicalRuntimeSeconds` L581 reads `tmdb_titles` inside the write path to decide `played`. Cross-domain read on mutation.
- **Expected:** `SELECT ws.item_id, ws.position_seconds, ws.played, ws.is_favorite, ws.rating, ws.last_played_at, ci.entity_type, cpr_tmdb.metadata` only — return `InternalRef[]` (`itemId + mediaType + perUserState`). No `tmdb_titles` join for `duration` at read time; duration for `progress_bps` comes from the boundary overlay or is omitted (boundary computes percent from `position_seconds` + `duration_seconds` joined at hydration time).

#### 2.2 `src/modules/integrations/watch-read.mapper.ts` — the fused brain
- **L7 `mapContinueWatchingRow`**, **L47 `mapRatingRow`**, **L68 `mapHistoryRow`**, **L99 `mapWatchStateRow`** → `watchCacheRecordToBaseItemDto({ title, posterUrl, backdropUrl, releaseYear, rating, genres… }, { ProviderIds, SeriesName, ParentIndexNumber… })`.
- Merges `watch_media_card_cache` display columns (`title/poster_url/backdrop_url` L155-158) with content-graph columns (`title_provider_id/season_number` L179-184) into one DTO. This file *is* the enrichment layer but placed inside the integration layer.
- **Expected:** deleted. Route reads `InternalRef[]` + calls boundary hydrator; no `BaseItemDto` is ever constructed.

#### 2.3 `src/modules/watch/watch-card-hydrator.service.ts` — reverse extractor
- **L17 `hydrateItems(items: BaseItemDto[])`** takes DTO as input, not `itemId[]`.
- **L66 `identityFromBaseItemDto`** does `ProviderIds.Tmdb` + `ParentIndexNumber/IndexNumber` + `Type` → `MediaIdentity`. Watch re-derives identity from display fields — backwards.
- **L36 `toClientMediaCard(view, { progress: progressFromUserData(UserData), itemId: Id, seriesTitle: SeriesName })`** overlays progress from inside the DTO.
- **L45 `toLightweightCard`** second hydration path when `extended=false` with `genres=[]/images=null` — divergent card shape depending on query param.
- Routes `watch.ts:156,222,296,324,352,380,401` all call `watchCardHydrator.hydrateItems(page.items, language)` with that `BaseItemDto[]`.
- **Expected:** `hydrateByIds(client, refs: InternalRef[], locale): Promise<ClientMediaCard[]>` — collects `identities` from `refs[].itemId` via `contentIdentityService`, one `buildCardViews` call, overlay `progressMap`.

#### 2.4 `src/modules/watch/watch-media-card-cache.repo.ts` + `watch-media-card-cache.service.ts` — shadow metadata store
- **Repo L115** `INSERT INTO watch_media_card_cache (item_id, media_type, title_provider, title, subtitle, poster_url, backdrop_url, still_url, logo_url, trailer_url, release_year, rating, maturity_rating, genres, overview, runtime_minutes, episode_title, episode_air_date …)` — 26 display columns duplicating `tmdb_titles` + `tmdb_images` + `tmdb_tv_episodes`.
- **Service L18 `upsertFromProjection`** enrichment on write path; written on every watch write, never invalidated on TMDB `expires_at`.
- **Expected:** delete table + repo + service entirely. Hydration reads `tmdb_titles` (already 90-day cached, indexed, hot in PG buffers). If a cache is later needed, it is `Map<mediaKey:locale → MetadataCardView>` at the enricher, not in the watch domain.

### P1 — Enrichment inside domain services (lift to route)

#### 2.5 `src/modules/watch/episodic-follow.service.ts`
- **L331 `loadEpisodesByShow` `SELECT show_tmdb_id, season_number, episode_number, air_date, tmdb_id, name FROM tmdb_tv_episodes`** — `name` (episode title) is a display field read inside watch policy. Needed only for rendering `"S02E05 — Title"`.
- **L85-91** `CanonicalNextEpisodeRef { itemId, airDate, seasonNumber, episodeNumber, title }` — `title` crosses the service boundary (`watch-episodic-follow.types.ts:9`).
- **L99 `metadataCardService.buildCardViews`** + **L102-138** builds full `EpisodicFollowView { show: MetadataCardView, nextEpisodeAirDate/nextEpisodeItemId/nextEpisodeTitle… }`. Returns hydrated cards; route `watch.ts:187` just forwards `items`.
- **Expected:** service returns `Array<{ showItemId, reason, lastInteractedAt, nextSeason, nextEpisode, nextAirDate, nextEpisodeItemId }>` (no `show`, no `title`). Route does `buildCardViews(showIdentities, locale)` → `ClientMediaCard[]` and merges `nextAirDate/nextEpisode...` as scalar fields alongside the card. `loadEpisodesByShow` `SELECT` drops `name`.

#### 2.6 `src/modules/metadata/person-detail.service.ts:64`
- **`buildKnownForItems`** does `getPersonCredits` → `inferMediaIdentity` → `ensureContentIds` → `buildMetadataCardView` → `toClientMediaCard` and returns `ClientMediaCard[]`. Route just forwards `person.knownFor`.
- **Expected:** service returns `TmdbTitleRecord[]` + `identities`; `GET /v1/persons/:id` route does one `buildCardViews` call → `ClientMediaCard[]`.

#### 2.7 `src/modules/metadata/metadata-title-extras.builder.ts`
- **`buildAllSeasons` L74**, **`buildRelated` L130**, **`buildFullCollection` L135**, **`buildRelatedItems` L158** all do `ensureContentIds/buildMetadataCardView/toClientMediaCard` and return `ClientMediaCard[]`.
- **Expected:** builder returns `TmdbTitleRecord[]` / `MediaIdentity[]`; `GET /v1/metadata/items/:id/extras` route hydrates once.

#### 2.8 `src/modules/search/title-search.service.ts`
- **L104-142 `searchTitles`** and **L194-210 `resolveAiCandidates`** both do `ensureContentIds → getTitles → buildMetadataCardView → toClientMediaCard` inside service, returning `ClientMediaCard`.
- **Expected:** service returns ranked `TmdbTitleRecord[]` + `identities`; `POST /v1/search/titles` route hydrates. Keeps `mapSearchFilterToTmdbTypes`/`scoreAiMatch` in service (pure logic), hydration at boundary.

### P2 — Clean (keep as reference, minor nips)

#### 2.9 `src/modules/home/home-hydrator.service.ts:36` — correct boundary
- Takes `HomeListInput` (only `itemId` strings) → batches `resolveMediaIdentitiesBatched` → `buildCardViewsForIdentities` → `toClientMediaCard` per section. This is the target pattern.
- Nits: fallback per-row `resolveIdentity` L135 + sequential `buildCardView` L94 for legacy `provider/providerId` rows is N+1, never batched. Delete legacy path once all lists carry `itemId`. Also `toClientCard` passes `row.description` as `overviewOverride` — list-config display data mixed with card hydration (acceptable but note).

#### 2.10 `src/modules/metadata/metadata-card.service.ts`
- **L15 `buildCardView`**, **L34 `buildCardViews`**, **L92 `buildCardViewsForIdentities`** — the one true enricher. Three methods exist only because `buildCardViews` does `ensureContentIds` writes vs `ForIdentities` is read-only. Consolidate to one batch method (`ensureContentIds` is idempotent; the write on GET is harmless) or keep `ForIdentities` but make it the sole batch path and have `buildCardViews` delegate to it.

---

## 3) Target architecture

```
Client request
  │
  ├─ Route handler (only place that knows ClientMediaCard)
  │    ├─ 1) call domain service → InternalRef[]   (Brain 1)
  │    ├─ 2) collect identities → MetadataCardService.buildCardViews(ids, locale)  (Brain 2)
  │    ├─ 3) overlay per-user progress map → toClientMediaCard(view, { progress, itemId })
  │    └─ 4) return ClientMediaCard[]
  │
  ├─ Domain services (never import toClientMediaCard / buildMetadataCardView)
  │    ├─ LocalUserWatchService        → InternalRef[] / void (mutations)
  │    ├─ EpisodicFollowService         → { showItemId, nextSeason, ... }[]
  │    ├─ TitleSearchService            → TmdbTitleRecord[] + identities
  │    ├─ PersonDetailService           → TmdbTitleRecord[] / credits
  │    └─ MetadataTitleExtrasBuilder   → identities / relations
  │
  └─ Metadata enrichment core (Brain 2, single)
       MetadataCardService + MetadataTitleSourceService + tmdb_* tables
```

**Boundary contract (new):**
```ts
type InternalRef = {
  itemId: string;                // public hex
  mediaType: 'movie'|'show'|'season'|'episode';
  progress: {
    positionSeconds: number;
    durationSeconds: number | null;
    played: boolean;
    isFavorite: boolean;
    rating: number | null;
    lastPlayedAt: string | null;
  } | null;
};
```

---

## 4) Phased plan

### Phase 0 — Freeze & measure (1 day, no behavior change)
- Add logging: count `watch_media_card_cache` hit rate, `WATCH_ITEM_CONTENT_JOIN` latency, `buildCardViews` batch sizes.
- Assert: `tmdb_titles` 90-day TTL, `content_provider_refs` indexes are hot. Prove boundary hydration without the cache is <10ms for 200 cards.
- Files: none (observability only).

### Phase 1 — Route-level hydration seam for watch (2-3 days, highest leverage)
- Introduce `hydrateByIds(client, InternalRef[], locale)` alongside existing `hydrateItems` (feature flag).
- Change `local-user-watch.service.ts` to expose `list*PageInternal` returning `InternalRef[]` (keep old `list*Page` returning `BaseItemDto` temporarily, deprecated).
- Update `watch.ts:142,208,281,310,338,366,385` to call `hydrateByIds` when flag on; compare `BaseItemDto` vs `ClientMediaCard` parity in tests (already have `watch-card-hydrator.service.test.ts`).
- Keep `watch_media_card_cache` read path but stop writing to it.
- **Verify:** `GET /v1/profiles/:id/watch/continue-watching?extended=true` returns identical `itemId` sets and `progress.percent` vs old path.

### Phase 2 — Episodic-follow split (2 days, depends on Phase 1 seam)
- Change `episodic-follow.service.ts`:
  - Drop `name` from `loadEpisodesByShow` SELECT (keep `airDate` for policy).
  - Remove `CanonicalNextEpisodeRef.title` and `EpisodicFollowView.show/nextEpisodeTitle` (publish new `InternalEpisodicFollow` type).
  - Delete `buildCardViews` call inside service; return internal refs.
- Update `watch.ts:187` `/episodic-follow` to hydrate `show` via `buildCardViews` and merge `nextEpisode*` scalars alongside `ClientMediaCard`.
- **Verify:** episodic-follow contract test — `show` card fields appear only after route hydration; `nextEpisodeTitle` is derived from episode's `MetadataCardView.title` at boundary.

### Phase 3 — Delete shadow store (1 day, after Phase 1 proven)
- Drop `watch_media_card_cache` table + `WatchMediaCardCacheService/Repo` + `watch-cache-miss-refresh.service.ts` (which builds `WatchMediaCardCacheRecord` from `tmdb_titles` — redundant with `MetadataCardService`).
- Delete `watch-read.mapper.ts` `playableMediaItemDtoFromRow/mediaItemDtoFromRow` and `BaseItemDto` construction from watch.
- Delete `WatchCardHydrator.toLightweightCard` / `extended=false` divergent path; all watch reads go through `hydrateByIds` with `extended` handled at boundary (or removed — every card is full).
- **Verify:** no `watch_media_card_cache` import remains (`grep watch_media_card_cache` = 0).

### Phase 4 — Lift metadata/search/known-for hydration to routes (3-4 days, parallelizable)
- `person-detail.service.ts`: `buildKnownForItems` → returns `TmdbTitleRecord[]`; `GET /v1/persons/:id` route builds cards.
- `metadata-title-extras.builder.ts`: `buildAllSeasons/buildRelated/buildFullCollection` → return `MediaIdentity[]`/`TmdbTitleRecord[]`; `GET /v1/metadata/items/:id/extras` route hydrates.
- `title-search.service.ts`: `searchTitles` → returns `{ matches: TmdbTitleRecord[], identities }`; search route hydrates via single `buildCardViews` call (keep scoring/ranking inside service).
- **Verify:** no service file imports `toClientMediaCard` after this phase (grep `toClientMediaCard` only in route handlers + `metadata-card.service.ts`).

### Phase 5 — Unify output shape + delete normalizer (2-3 days)
- Migrate detail/playback endpoints from `BaseItemDto` to `ClientMediaCard` (or `MetadataDetailResponse { card: ClientMediaCard, extras }`).
- Delete `MediaStateContract` (`ios/ContractRunner/...`, `android/core-domain/...`) and `ItemId ?: Id` fallback chains in `parseMediaItem`/`CrispyBackendParsers.ts:282` and `CrispyBackendModels.swift:152`.
- Clients: single decoder `ClientMediaCard.parse` everywhere.
- **Verify:** client `MediaStateContract` test suites removed; `BaseItemDto` import count = 0 outside `media-item.types.ts` (kept for migration history only).

### Phase 6 — Consolidate MetadataCardService (1 day, cleanup)
- Merge `buildCardViews` + `buildCardViewsForIdentities` into one batched method (or have former delegate to latter). Remove legacy `provider/providerId` row path from `home-hydrator`.
- Keep `buildCardView` (single) as thin wrapper for detail page.

---

## 5) Risks & mitigations

| Risk | Mitigation |
|---|---|
| `WATCH_ITEM_CONTENT_JOIN` duration needed for `played` decision (`resolvePlayState`) | Keep `resolveCanonicalRuntimeSeconds` as a dedicated `SELECT runtime FROM tmdb_titles/tve` scalar query on the write path only; do not join for reads. Read path computes `progress.percent` from `position_seconds` at boundary. |
| `show_unaired_next_up` policy needs `airDate` | Keep `airDate` in `tmdb_tv_episodes` and read it in `episodic-follow.service.ts` — small scalar, not a full card. Title still at boundary. |
| Cache miss storm after dropping `watch_media_card_cache` | `tmdb_titles` is already cached + indexed; `buildCardViews` batches by 200. Bench Phase 0 before deleting. Add in-memory `Map<mediaKey:locale → MetadataCardView>` inside `MetadataCardService` if needed (keyed by identity, invalidated by `expires_at`). |
| Client breakage on `EpisodicFollowView` shape change | Version the endpoint (`/v1/.../episodic-follow` → new shape `{ show: ClientMediaCard, nextEpisode: ClientMediaCard|null }`) or dual-field (`showCard` alongside legacy `show`) with feature flag until clients cut over. |

---

## 6) Success criteria

- No service file (outside `src/modules/metadata/`) imports `toClientMediaCard` or `buildMetadataCardView`.
- No watch file imports `BaseItemDto` or `watchCacheRecordToBaseItemDto`.
- `watch_media_card_cache` table does not exist; grep `watch_media_card_cache` = 0.
- `MediaStateContract` deleted; clients have one decoder (`ClientMediaCard`).
- `episodic-follow.service.ts` never reads `tmdb_tv_episodes.name`; `CanonicalNextEpisodeRef` has no `title`.
- Every `GET /v1/**` returning cards builds them via one `MetadataCardService` call in the route handler — verifiable by `grep -rn buildCardViews src/http/routes`.

---

## 7) File checklist (touched / deleted)

**Touched:** `src/http/routes/watch.ts`, `src/modules/watch/episodic-follow.service.ts`, `src/modules/watch/watch-episodic-follow.types.ts`, `src/modules/integrations/local-user-watch.service.ts`, `src/modules/integrations/watch-read.mapper.ts` (deleted), `src/modules/watch/watch-card-hydrator.service.ts` (rewritten), `src/modules/metadata/person-detail.service.ts`, `src/modules/metadata/metadata-title-extras.builder.ts`, `src/modules/search/title-search.service.ts`, `src/http/routes/metadata.ts`, `src/http/routes/search.ts`, `src/modules/metadata/metadata-card.service.ts` (consolidate).

**Deleted:** `src/modules/watch/watch-media-card-cache.service.ts`, `src/modules/watch/watch-media-card-cache.repo.ts`, `src/modules/watch/watch-cache-miss-refresh.service.ts`, `src/modules/integrations/watch-read.mapper.ts`, `MediaStateContract.swift`/`MediaStateContract.kt` (both clients).

---

## 8) Open questions (no code until answered)

- `GET /v1/profiles/:id/watch/state` batch endpoint `watchState` — does it need full cards or is `InternalRef` enough for the player's polling use case? If polling, `InternalRef` is cheaper and sufficient; keep card hydration separate.
- `showUnairedNextUp` lives in `identity.profile_preferences.settings_json` — should this move to a dedicated `profile_settings` column/table instead of JSON?
