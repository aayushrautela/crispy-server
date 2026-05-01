# Media Type Classification and Provider Routing Plan

> Archived/historical plan. This document predates the current TMDB-only canonical identity architecture and may mention TVDB/Kitsu provider authority or first-class anime identity. Do not implement new code from those assumptions; use `architecture.md` and `RECOMMENDATION_ENGINE_CONTRACT.md` instead.

## Why This Plan Exists

This document is now historical context for the earlier provider-authority migration. Many of the mixed metadata seams it references have already been deleted as part of the modular-monolith split.

The important implementation fact is:

- the system does **not** currently treat `content_id` as the only real identity anchor
- it still reconstructs canonical identity through TMDB-shaped keys and TMDB-shaped columns
- changing providers for shows and anime therefore requires an identity migration first, not just new API clients

This document is the implementation plan for moving to exclusive provider authority by media family:

- movies -> TMDB
- shows -> TVDB
- anime -> Kitsu

## Current Repo Constraints

These are the hotspots that make this a cross-cutting migration:

- `src/modules/watch/media-key.ts` only understands `movie | show | episode` and only parses `*:tmdb:*` media keys.
- `src/modules/identity/content-identity.service.ts` still carries canonical-id responsibilities and remains a key identity seam.
- The old mixed orchestration layers (`metadata-view.service.ts`, `metadata-query.service.ts`, `metadata-direct.service.ts`) have been deleted. Their responsibilities now live in split services such as `metadata-detail.service.ts`, `metadata-detail-core.service.ts`, `title-search.service.ts`, `playback-resolve.service.ts`, and `episode-navigation.service.ts`.
- `migrations/0002_watch_domain.sql` stores `tmdb_id` and `show_tmdb_id` in watch tables.
- `migrations/0005_provider_imports_and_recommendations.sql` stores TMDB-shaped identifiers in import history and recommendation outbox rows.
- `src/modules/watch/tracked-series.repo.ts`, `src/modules/calendar/calendar-builder.service.ts`, and `src/modules/metadata/tmdb-refresh.service.ts` all treat `show_tmdb_id` as tracked-series identity.
- `src/modules/imports/provider-import.service.ts` currently funnels anime through show/TMDB assumptions.
- `src/modules/library/library.service.ts` dedupes provider items using `movie:tmdb:*`, `show:tmdb:*`, and `episode:tmdb:*` keys.

The plan below explicitly addresses those constraints.

## Canonical Entity Types

```text
movie | show | anime | season | episode | person
```

- `movie` -> standalone films. Authority provider: TMDB.
- `show` -> non-anime episodic TV titles. Authority provider: TVDB.
- `anime` -> anime titles. Authority provider: Kitsu.
- `season` -> generic child entity of `show` or `anime`. It inherits the parent authority provider.
- `episode` -> generic child entity of `show` or `anime`. It inherits the parent authority provider.
- `person` -> cast/crew/person detail. Authority provider: TMDB for now.

Decision locked in now:

- `anime` is first-class in `entity_type` and in public/internal `mediaType`.
- `season` and `episode` remain generic child entities; we are **not** introducing `anime_episode` or `anime_season` unless Kitsu modeling later proves that generic children are insufficient.

## Canonical Identity Rules

### Internal rule

- `content_items.id` is the only stable identity users should ultimately depend on.
- `content_provider_refs` stores all authority and alternate provider mappings.
- `mediaKey` is a projection and lookup key, not the ultimate source of truth.

### Authority matrix

| entityType | authority provider | canonical media key example |
|------------|--------------------|-----------------------------|
| movie | tmdb | `movie:tmdb:550` |
| show | tvdb | `show:tvdb:81189` |
| anime | kitsu | `anime:kitsu:1` |
| season (show) | tvdb | `season:tvdb:81189:1` |
| season (anime) | kitsu | `season:kitsu:1:1` or provider-native season-like projection |
| episode (show) | tvdb | `episode:tvdb:81189:1:1` |
| episode (anime) | kitsu | `episode:kitsu:1:24` or provider-native projection |
| person | tmdb | `person:tmdb:287` |

### Media identity shape

The current TMDB-shaped identity object must be replaced with a provider-aware shape.

Minimum required shape:

```ts
type SupportedMediaType = 'movie' | 'show' | 'anime' | 'season' | 'episode';

type SupportedProvider = 'tmdb' | 'tvdb' | 'kitsu';

type MediaIdentity = {
  contentId?: string | null;
  mediaKey: string;
  mediaType: SupportedMediaType;
  provider: SupportedProvider;
  providerId: string;
  parentContentId?: string | null;
  parentProvider?: SupportedProvider | null;
  parentProviderId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
  providerMetadata?: Record<string, unknown>;
};
```

Important rule:

- anime identity must allow provider-native coordinates in addition to `seasonNumber` and `episodeNumber`
- do not force all anime lineage into TVDB-like season semantics

## Classification Rules

There are five input contexts. Each has a classification path.

### Context 1: Search

Search should always route by filter.

```text
filter='movies' -> TMDB movie search
filter='series' -> TVDB series search
filter='anime'  -> Kitsu search
filter='all'    -> fan out to all three and merge results
```

Rules:

- provider result type determines classification
- TMDB contributes movies only to canonical title search results
- TVDB contributes shows only to canonical title search results
- Kitsu contributes anime only to canonical title search results

### Context 2: Imports (Trakt and Simkl)

Source providers classify items, but their classification is not always the final answer.

#### Trakt

```text
trakt movie -> tmdb_id available -> movie:tmdb:{id}
trakt show  -> tvdb_id available -> show:tvdb:{id}
trakt show  -> no tvdb_id, has tmdb_id -> resolve tvdb_id through crosswalk and store as show:tvdb:{id}
```

#### Simkl

```text
simkl movie -> tmdb_id -> movie:tmdb:{id}
simkl show  -> tvdb_id -> show:tvdb:{id}
simkl anime -> kitsu_id or mal_id or anilist_id -> resolve kitsu_id -> anime:kitsu:{id}
simkl anime -> only tvdb_id and no anime crosswalk -> treat as show:tvdb:{id}
```

Import classification rules:

- if source says `movie` -> classify as `movie`
- if source says `show` -> classify as `show`, unless anime-specific IDs prove it should be `anime`
- if source says `anime` -> classify as `anime`, unless only TVDB lineage exists and no Kitsu crosswalk can be found
- if classification cannot be resolved confidently, do **not** force a guess into canonical history; store it as unresolved import work and surface it in job summary

### Context 3: Direct resolve with explicit mediaType

This is the preferred external resolve path.

```text
resolve?tmdbId=550&mediaType=movie -> movie:tmdb:550
resolve?tvdbId=81189&mediaType=show -> show:tvdb:81189
resolve?kitsuId=1&mediaType=anime -> anime:kitsu:1
resolve?tmdbId=1396&mediaType=show -> resolve tvdbId, then canonicalize to show:tvdb:{id}
resolve?tmdbId=1396&season=1&episode=1&mediaType=episode -> resolve parent authority, then canonicalize as episode under TVDB or Kitsu
```

Rules:

- explicit `mediaType` wins over heuristics
- non-authority IDs are accepted as convenience inputs only
- canonical output must always be authority-provider identity or canonical `content_id`

### Context 4: Direct resolve without mediaType

This is the ambiguous path and should be conservative.

Resolution order:

```text
has kitsuId -> anime
has tvdbId  -> show-family input
has tmdbId  -> inspect TMDB movie/tv classification
has imdbId  -> TMDB find, then TVDB find, then anime crosswalk lookup if still unresolved
```

Rules:

- a bare `tvdbId` should be interpreted as show-family input for this app
- a bare `kitsuId` is anime
- a bare `tmdbId` still needs movie vs show classification before canonical routing
- if auto-detect stays ambiguous, return a 400 or 404 rather than persisting unstable identity

### Context 5: Canonical content ID resolve

When a client sends a `content_id`, the title is already classified.

```text
content_items.entity_type determines movie/show/anime/season/episode/person
content_provider_refs provides the authority and alternate provider ids
```

Reverse resolution rule:

- `content_id` resolution must stop assuming a TMDB ref is always present
- it must select the authority ref based on `content_items.entity_type`

## Content Provider Refs Strategy

### Authoritative provider first

When new content is encountered:

1. classify entity type as `movie`, `show`, `anime`, `season`, `episode`, or `person`
2. determine the authority provider from entity type or parent title lineage
3. resolve the authority provider id
4. create or reuse a `content_items` row
5. create or upsert the authority `content_provider_refs` row
6. attach alternate provider refs later as crosswalks are discovered

### Merge strategy

This must be explicit, because the current repository code creates a new `content_id` when it sees a previously unseen provider ref.

Rules:

- authority refs create canonical rows first
- alternate refs must try to attach to an existing canonical `content_id` before creating a new row
- if two already-created `content_id` rows later prove to be the same logical title, merge tooling or a repair migration is required; do not leave duplicate canonicals in place
- `content_provider_refs` becomes the system of record for external crosswalks

### Reverse resolution

When resolving `content_id -> authority ref`:

- movie -> use `provider='tmdb'`
- show -> use `provider='tvdb'`
- anime -> use `provider='kitsu'`
- season/episode -> use the parent title authority provider
- person -> use `provider='tmdb'`

If the authority ref is missing, either:

- resolve it from alternate refs and repair `content_provider_refs`, or
- fail loudly as a data-integrity issue

## Watch History and Progress Stability

### Non-negotiable rule

User watch history, progress, ratings, watchlist state, and continue watching must anchor to canonical content identity, not to TMDB-only columns.

Recommended storage direction:

- store `content_id` on watch/projection/history tables
- keep `media_key` as a denormalized lookup string
- keep provider-native ids only where denormalization is actually needed for performance or compatibility

### Episode numbering rules

For shows:

- canonical episode coordinates follow TVDB numbering
- if TMDB numbering differs, TMDB coordinates are translated during import or resolve and then discarded as canonical identity

For anime:

- canonical episode coordinates follow Kitsu numbering or a stable Kitsu-derived projection
- the identity model must allow provider-native episode metadata if Kitsu does not map cleanly onto season-based coordinates

### Continue watching rule

Continue watching grouping must collapse by canonical parent title identity, not by TMDB show id.

Examples:

- movie progress groups by the movie's canonical `content_id`
- episodic progress groups by the parent show/anime canonical `content_id`

### Import rule

When importing playback or watched episodes:

1. classify title as movie/show/anime
2. resolve title to authority provider id
3. translate episode coordinates into authority numbering
4. materialize or reuse canonical `content_id`
5. persist watch rows against canonical identity

If coordinate translation cannot be performed confidently, mark the item unresolved instead of writing unstable watch history.

## Required Schema Changes

### Content identity schema

- update `content_items.entity_type` to allow `anime`
- update identity services and migrations so reverse resolution is authority-aware, not TMDB-first
- add any parent linkage metadata needed for seasons and episodes

### Watch domain schema

Affected tables include:

- `watch_events`
- `media_progress`
- `watch_history`
- `watchlist_items`
- `ratings`
- `continue_watching_projection`
- `watch_history_entries`
- `recommendation_event_outbox`
- `profile_tracked_series`

Recommended schema direction:

- add `content_id uuid` where canonical identity is needed
- add provider-aware columns only if needed for query performance or compatibility
- migrate `profile_tracked_series` from `show_tmdb_id` to `content_id` or equivalent canonical parent identity
- migrate continue-watching canonical grouping from `show:tmdb:*` to canonical parent identity

Compatibility rule:

- old TMDB-shaped columns can exist temporarily during migration
- new writes should target canonical identity first
- old columns should become compatibility projections and eventually be removed

## Metadata and Provider Service Changes

### Provider clients

- keep TMDB for movie metadata and TMDB people
- add `tvdb.client.ts` for show search, show detail, seasons, episodes, and external-id lookup where available
- add `kitsu.client.ts` for anime search, anime detail, episode lineage, and category/relationship lookups

### Normalized metadata assembly

Do not force TVDB or Kitsu raw payloads into TMDB record shapes.

Introduce:

- provider-specific raw record types
- provider-specific normalizers
- provider-neutral output shapes such as `MetadataView`, `MetadataCardView`, `MetadataEpisodeView`, and `MetadataSeasonView`

### Service routing

- `TitleSearchService` is the provider-routed search boundary
- `MetadataDetailService` is the public resolve/title/season detail boundary
- `PlaybackResolveService`, `EpisodeNavigationService`, `MetadataContentService`, and `PersonDetailService` own the former direct-service responsibilities
- `MetadataDetailCoreService` is the current provider-aware detail assembler/facade
- `ContentIdentityService` becomes authority-aware for both forward and reverse resolution

## API Contract Changes

### Request changes

- add `anime` to public `mediaType`
- add `anime` to search filter: `all | movies | series | anime`
- accept `kitsuId` as a direct resolve input
- keep `tmdbId` for movie resolve
- allow `tmdbId` or `imdbId` as convenience inputs for shows, but canonicalize to TVDB before returning

### Response changes

Public responses should move toward provider-neutral identity.

Preferred fields:

- `id` -> canonical `content_id` for internal/storage-oriented flows only
- `mediaType`
- `mediaKey`
- `provider`
- `providerId`
- `externalIds`

Transitional compatibility fields may still be returned during rollout, but they should be treated as deprecated:

- `tmdbId`
- `showTmdbId`

## Imports, Library, Calendar, Recommendations, and Refresh

### Imports

- route imported movies to TMDB authority
- route imported shows to TVDB authority
- route imported anime to Kitsu authority
- add explicit unresolved-item handling when provider ids or episode crosswalks are incomplete

### Library hydration

- stop deduping provider items by `show:tmdb:*` or `episode:tmdb:*`
- dedupe by canonical `content_id` when available, then by provider-aware canonical media keys
- hydrate all provider folders through provider-aware metadata resolution

### Calendar

- stop deriving next episodes from TMDB TV data only
- build calendar entries from the tracked title's authority provider lineage
- tracked parent identity must be canonical `content_id`, not `show_tmdb_id`

### Recommendations

- stop emitting TMDB-shaped outbox identity as the source of truth
- recommendation hydration should interpret rows via canonical `content_id` and provider-aware media identity

### Refresh

- replace `TmdbRefreshService` with a provider-aware refresh dispatcher/orchestrator
- refresh tracked movies from TMDB, tracked shows from TVDB, and tracked anime from Kitsu
- keep TMDB person refresh logic separate if people stay TMDB-backed

## Repo Areas To Update First

Highest-priority files and modules:

- `src/modules/watch/media-key.ts`
- `src/modules/metadata/content-identity.service.ts`
- `src/modules/metadata/content-identity.repo.ts`
- `src/modules/metadata/metadata-detail-core.service.ts`
- `src/modules/metadata/metadata-detail.service.ts`
- `src/modules/search/title-search.service.ts`
- `src/modules/metadata/playback-resolve.service.ts`
- `src/modules/metadata/episode-navigation.service.ts`
- `src/modules/metadata/metadata-content.service.ts`
- `src/modules/watch/projector.service.ts`
- `src/modules/watch/watch-state.service.ts`
- `src/modules/watch/tracked-series.repo.ts`
- `src/modules/imports/provider-import.service.ts`
- `src/modules/library/library.service.ts`
- `src/modules/calendar/calendar-builder.service.ts`
- `src/modules/recommendations/recommendation-data.service.ts`
- `src/modules/metadata/tmdb-refresh.service.ts` -> replace with provider-aware refresh orchestration
- `src/http/contracts/metadata.ts`
- `src/http/routes/metadata.ts`
- `src/config/env.ts`

## Recommended Implementation Order

### Phase 1: Identity model and canonical rules

- add `anime` to supported media types and content entity types
- redesign `MediaIdentity` and `mediaKey` parsing/inference to be provider-aware
- make `ContentIdentityService` authority-aware in both directions
- define explicit merge behavior for `content_provider_refs`

### Phase 2: Schema and canonical watch storage

- add canonical `content_id` to watch and projection tables
- migrate tracked-series identity away from `show_tmdb_id`
- migrate continue watching away from `show:tmdb:*`
- keep temporary compatibility columns only where needed

### Phase 3: Provider clients and caches

- add TVDB and Kitsu clients
- split provider caches and repos from TMDB-only storage
- introduce provider-neutral normalized metadata types

### Phase 4: Metadata services and contracts

- route search, resolve, playback, episode list, and next-episode flows by authority provider
- update HTTP contracts to accept `anime` and `kitsuId`
- keep the public client contract `mediaKey`-only with no temporary compatibility path

### Phase 5: Watch state and projections

- update ingest, projector, read services, and rebuild flows to write canonical identity
- ensure continue watching and watched episode lookup group by canonical parent title identity

### Phase 6: Imports and library

- rework Trakt and Simkl normalization to canonical provider authority
- add unresolved import handling and episode-coordinate translation
- switch library hydration and dedupe to canonical identity

### Phase 7: Calendar, recommendations, and refresh

- update calendar builder, recommendation hydration, and metadata refresh orchestration to use provider-aware identity

### Phase 8: Backfill and cleanup

- backfill old TMDB-shaped rows to canonical identity
- validate compatibility behavior for old clients
- remove TMDB-TV assumptions only after data migration and parity checks pass

## Testing and Rollout Safety

High-priority test areas:

- media key parsing and inference
- content identity forward and reverse resolution
- provider-aware metadata normalization and search routing
- direct resolve and playback resolve
- watch projector, watch state, and projection rebuild logic
- import normalization and unresolved-item handling
- library dedupe and hydration
- calendar next-episode behavior
- refresh dispatcher behavior

Rollout rules:

- do not remove TMDB-TV assumptions until new canonical identity writes and backfills are verified
- dual-read or compatibility-read where needed during the migration window
- fail closed on ambiguous imports rather than corrupting watch history

## Decisions Already Made

- `anime` is first-class now
- canonical authority is exclusive by media family
- `content_id` is the long-term stable identity anchor
- seasons and episodes stay generic child entities
- TMDB remains the person authority for now

## Remaining Open Decision

One implementation detail still needs to be finalized during coding:

- what exact provider-native coordinate shape we persist for Kitsu-backed episodes and seasons when Kitsu does not map perfectly to season-based UI projections

Default recommendation:

- keep the public/internal normalized view capable of projecting `seasonNumber` and `episodeNumber`
- store enough provider-native metadata on anime episode identity to round-trip Kitsu lineage without forcing fake TVDB semantics
