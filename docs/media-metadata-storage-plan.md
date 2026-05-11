# Media Metadata Storage Implementation Plan

## Final architecture decision

Use the existing split:

```txt
Supabase Postgres
  private/user-owned watch state
  history, watchlist, ratings, continue-watching, playback state
  RLS-protected RPC reads/writes

API server Postgres
  shared metadata/cache
  TMDB titles, seasons, episodes, external IDs, ratings enrichment, media-card cache

Redis
  short-lived locks, queues, request coalescing, optional hot cache

TMDB/providers
  external source of truth, used only on cache miss/stale refresh
```

Do **not** upgrade Supabase only to store movie metadata. Upgrade Supabase later only for user-state production needs: PITR, backups, higher DB load, connection limits, storage/egress, or SLA.

## Current codebase facts

### Supabase user-state path

Current public watch routes already read/write Supabase through `SupabaseUserWatchService`:

- `src/http/routes/watch.ts`
  - `/v1/profiles/:profileId/watch/continue-watching`
  - `/v1/profiles/:profileId/watch/history`
  - `/v1/profiles/:profileId/watch/watchlist`
  - `/v1/profiles/:profileId/watch/ratings`
  - `/v1/profiles/:profileId/watch/state`
  - mutation routes for playback, watched, list, rating
- `src/modules/integrations/supabase-user-watch.service.ts`
  - `listContinueWatchingPage`
  - `listHistoryPage`
  - `listWatchlistPage`
  - `listRatingsPage`
  - `getState` / `getStates`
- `src/modules/integrations/supabase-watch-read.mapper.ts`
  - maps Supabase RPC rows into product items

### API Postgres metadata path

The API server Postgres already has media metadata/cache tables:

- `migrations/0004_tmdb_metadata.sql`
  - `tmdb_titles`
  - `tmdb_tv_seasons`
  - `tmdb_tv_episodes`
- `migrations/0022_watch_media_card_cache.sql`
  - `watch_media_card_cache`
- `src/modules/metadata/providers/tmdb-cache.service.ts`
  - TTL read-through TMDB cache
- `src/modules/metadata/providers/tmdb.repo.ts`
  - TMDB persistence
- `src/modules/watch/watch-media-card-cache.repo.ts`
  - `getByMediaKeys(client, mediaKeys)` already performs a batch `ANY($1::text[])` lookup
- `src/modules/watch/watch-media-card-cache.service.ts`
  - `listRegularCards(client, mediaKeys)` already returns a map for batched enrichment

## Goal

Make Supabase watch reads return user facts, then enrich those rows with metadata from API Postgres in one batch per page.

For a 100-row history page, target request shape:

```txt
1 Supabase RPC call
1 API Postgres batch metadata/card call
0 per-row DB calls
0 TMDB calls on warm cache
```

## Non-goals

- Do not move full TMDB metadata into Supabase.
- Do not store poster image binaries in Supabase Storage.
- Do not store poster images in Postgres.
- Do not call TMDB for every history/list page render.
- Do not create user-specific duplicated metadata rows unless explicitly needed for import provenance.

## Data ownership rules

### Supabase stores user facts only

Supabase rows should be allowed to contain:

```txt
profile_id
media_key
title_media_key / playable_media_key
media_type
watched_at / added_at / rated_at / last_activity_at
rating/progress fields
source_kind/source_provider/origins
provider import identifiers
```

Supabase should not be the canonical source for:

```txt
title
poster_url
backdrop_url
release_year
metadata_rating
overview
cast
trailers
genres
recommendations
```

Supabase RPCs must return user-state fields only. Do not add title/poster/backdrop/release-year/rating snapshot columns to Supabase read models. If a new watch read RPC is added, it should expose identifiers and user facts only; API enrichment is responsible for all response metadata.

### API Postgres stores shared metadata/cache

API Postgres remains canonical for response metadata:

```txt
tmdb_titles
  media_type
  tmdb_id
  name
  original_name
  overview
  release_date
  first_air_date
  poster_path
  backdrop_path
  runtime
  number_of_seasons
  number_of_episodes
  external_ids
  raw
  fetched_at
  expires_at

tmdb_tv_seasons
tmdb_tv_episodes
watch_media_card_cache
imdb_ratings
```

## Response enrichment design

### Add one enrichment service

Create a dedicated service:

```txt
src/modules/watch/watch-supabase-enrichment.service.ts
```

Responsibilities:

- accept already-mapped product items from `SupabaseUserWatchService`
- extract unique `media.mediaKey` values
- query API Postgres once through `WatchMediaCardCacheService.listRegularCards`
- replace placeholder/fallback `media` fields with API Postgres card fields
- preserve user-state fields such as `watchedAt`, `addedAt`, `rating.value`, `progress`, `origins`
- tolerate missing cards
- optionally queue/cache-miss refresh work later

Suggested class shape:

```ts
export class WatchSupabaseEnrichmentService {
  constructor(
    private readonly mediaCardCacheService = new WatchMediaCardCacheService(),
  ) {}

  async enrichHistoryPage(client: DbClient, page: PaginatedWatchCollection<HistoryProductItem>): Promise<PaginatedWatchCollection<HistoryProductItem>>
  async enrichWatchlistPage(client: DbClient, page: PaginatedWatchCollection<WatchlistProductItem>): Promise<PaginatedWatchCollection<WatchlistProductItem>>
  async enrichRatingsPage(client: DbClient, page: PaginatedWatchCollection<RatingProductItem>): Promise<PaginatedWatchCollection<RatingProductItem>>
  async enrichContinueWatchingPage(client: DbClient, page: PaginatedWatchCollection<ContinueWatchingProductItem>): Promise<PaginatedWatchCollection<ContinueWatchingProductItem>>
  async enrichStates(client: DbClient, states: WatchStateResponse[]): Promise<WatchStateResponse[]>
}
```

Implementation detail:

```txt
mediaKeys = unique page.items.map(item => item.media.mediaKey)
cardsByKey = await watchMediaCardCacheService.listRegularCards(client, mediaKeys)
for each item:
  card = cardsByKey.get(item.media.mediaKey)
  if card exists:
    item.media = merge card into existing media
  else:
    keep existing Supabase fallback media
```

### Landscape vs regular cards

`continue-watching` uses `LandscapeCardView`; `watch_media_card_cache` currently returns `RegularCardView`.

For continue-watching, merge only compatible fields:

```txt
title
posterUrl
releaseYear
rating
genre
subtitle
mediaKey
```

Keep Supabase/fallback fields for:

```txt
backdropUrl
seasonNumber
episodeNumber
episodeTitle
airDate
runtimeMinutes
```

If `watch_media_card_cache` has `backdrop_url`, add a repository/service method that exposes it, or extend `RegularCardView` mapping internally for continue-watching enrichment.

Recommended implementation:

- Add `listCardCacheRecords(client, mediaKeys)` to `WatchMediaCardCacheService`, returning `WatchMediaCardCacheRecord` map.
- Use records directly in the new enrichment service.
- Keep existing `listRegularCards` for old callers.

Files:

- modify `src/modules/watch/watch-media-card-cache.service.ts`
- reuse `src/modules/watch/watch-media-card-cache.repo.ts#getByMediaKeys`

## Route integration

Modify `src/http/routes/watch.ts`.

### Instantiate dependencies

Current:

```ts
const supabaseUserWatchService = new SupabaseUserWatchService();
```

Target:

```ts
const supabaseUserWatchService = new SupabaseUserWatchService();
const watchSupabaseEnrichmentService = new WatchSupabaseEnrichmentService();
```

Also import `withDbClient`:

```ts
import { withDbClient } from '../../lib/db.js';
```

### Enrich history route

Current route returns Supabase page directly:

```ts
const page = await supabaseUserWatchService.listHistoryPage(...);
return { items: page.items, pageInfo: page.pageInfo };
```

Target:

```ts
const page = await supabaseUserWatchService.listHistoryPage(...);
const enrichedPage = await withDbClient((client) =>
  watchSupabaseEnrichmentService.enrichHistoryPage(client, page),
);
return { items: enrichedPage.items, pageInfo: enrichedPage.pageInfo };
```

Apply the same pattern to:

- continue-watching
- history
- watchlist
- ratings
- state
- states batch

For `state`, wrap the single response as an array or add `enrichState` helper.

### Keep mutations unchanged

Do not enrich mutation responses. Existing mutation routes can stay as-is:

- playback event
- dismiss continue-watching
- mark/unmark watched
- add/remove watchlist
- set/delete rating

## Media-key requirements

The enrichment path depends on stable media keys matching `watch_media_card_cache.media_key`.

Verify all Supabase RPC rows expose the same key format used by local cache:

```txt
movie:tmdb:<id>
show:tmdb:<id>
season:tmdb:<show_id>:<season>
episode:tmdb:<show_id>:<season>:<episode>
```

Check mapper inputs in:

- `src/modules/integrations/supabase-watch-read.mapper.ts`
  - `media_key`
  - `title_media_key`
  - `playable_media_key`

If Supabase returns episode/playable keys for history but cache stores title keys, normalize before lookup:

```txt
regular history/watchlist/rating: use item.media.mediaKey
continue-watching: prefer item.media.mediaKey/title key for title-card metadata, keep playable progress separately
```

If needed, use existing helpers:

- `src/modules/identity/media-key.ts`
  - `parseMediaKey`
  - `canonicalContinueWatchingMediaKey`

## Cache-miss strategy

### Phase 1 behavior

On missing `watch_media_card_cache` rows:

- keep deterministic fallback card values derived from the media key
- return the paginated response without waiting for TMDB
- log miss counts per endpoint
- trigger API-side background refresh for only the missing keys from the current page

This keeps history fast and avoids accidental TMDB fanout.

### Phase 2 behavior

The background refresh path should:

```txt
missing media keys from current page
  -> dedupe keys
  -> build metadata projection from API Postgres/TMDB cache
  -> call TMDB only when API metadata cache is cold/stale
  -> upsert watch_media_card_cache
```

Batch behavior:

- never refresh more than the requested page's missing keys
- skip invalid/non-TMDB keys
- keep user response latency independent from TMDB latency
- later add Redis locks if miss traffic becomes high

### Phase 3 behavior for detail pages

Detail pages may refresh synchronously because the user explicitly opened the movie/show.

Keep using:

- `TmdbCacheService.getTitle`
- `TmdbCacheService.ensureTitleCached`
- existing metadata detail/title-page services

Do not route detail-page full metadata through Supabase.

## Building media cards from TMDB cache

If `watch_media_card_cache` is missing but `tmdb_titles` exists, add a fallback builder so warm TMDB title rows can produce cards without an external call.

Recommended service:

```txt
src/modules/watch/watch-media-card-builder.service.ts
```

Responsibilities:

- parse media key
- load `tmdb_titles` for movie/show title keys
- for episode/season keys, load parent show title and optionally episode/season rows
- build poster/backdrop URLs using existing metadata image utilities
- upsert `watch_media_card_cache`

Use existing URL builder:

- `src/modules/metadata/metadata-builder.shared.ts`
  - `buildImageUrl`
  - `buildMetadataImages`

Minimum fields for card cache:

```txt
media_key
title_provider = tmdb
title_provider_id
title_media_type
title
subtitle
poster_url
backdrop_url
release_year
rating
```

## SQL/index requirements

Existing table `watch_media_card_cache` already has:

```sql
PRIMARY KEY (media_key)
INDEX (title_provider, title_provider_id)
```

This is enough for `WHERE media_key = ANY($1::text[])`.

Add no new table for the first implementation.

Optional future migration:

```sql
ALTER TABLE watch_media_card_cache
ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_watch_media_card_cache_expires_at
ON watch_media_card_cache(expires_at);
```

Only add this if card staleness needs to be managed independently of `tmdb_titles.expires_at`.

## Observability implementation

Add timings around the route-level operations.

Recommended small helper:

```txt
src/lib/timing.ts
```

or inline timing using `performance.now()`.

Log structured fields:

```txt
endpoint
profileId
limit
supabaseMs
metadataMs
itemCount
metadataHitCount
metadataMissCount
totalMs
```

Use existing logger:

- `src/config/logger.ts`

Important: do not log access tokens, user JWTs, provider secrets, or raw Supabase errors with sensitive request headers.

## Testing plan

### Unit tests

Add tests for the new enrichment service:

```txt
src/modules/watch/watch-supabase-enrichment.service.test.ts
```

Test cases:

1. enriches history media from cache record
2. preserves `watchedAt`, `id`, `origins`
3. preserves rating item `rating.value` and `rating.ratedAt`
4. enriches watchlist media and preserves `addedAt`
5. enriches continue-watching title/poster while preserving progress and episode fields
6. leaves item unchanged when cache miss
7. dedupes duplicate media keys before repository call
8. handles empty pages without DB query

### Route/integration tests

If existing route tests exist, add coverage for:

```txt
GET /v1/profiles/:profileId/watch/history
GET /v1/profiles/:profileId/watch/watchlist
GET /v1/profiles/:profileId/watch/ratings
GET /v1/profiles/:profileId/watch/continue-watching
POST /v1/profiles/:profileId/watch/states
```

Assertions:

- Supabase RPC mocked rows contain stale/fallback title/poster
- API Postgres cache contains canonical title/poster
- response uses API Postgres metadata
- pageInfo remains from Supabase RPC
- only one metadata batch lookup happens per endpoint call

### Performance check

Create a local/manual test with 100 history items:

- seed Supabase/mock RPC with 100 rows
- seed `watch_media_card_cache` with 100 matching rows
- call history endpoint
- confirm one Supabase read and one local Postgres metadata query
- record p50/p95 after several runs

Target:

```txt
100 warm items
  API metadata query: <30ms local typical
  total route overhead excluding network: low double-digit ms
```

## Implementation phases

### Phase 1: Read-only batched enrichment

Files to modify:

- `src/modules/watch/watch-media-card-cache.service.ts`
- add `src/modules/watch/watch-supabase-enrichment.service.ts`
- `src/http/routes/watch.ts`

Steps:

1. Add `listCardCacheRecords(client, mediaKeys)` to `WatchMediaCardCacheService`.
2. Create `WatchSupabaseEnrichmentService`.
3. Implement enrichment for history/watchlist/ratings.
4. Implement enrichment for continue-watching with landscape-safe merge.
5. Implement enrichment for state/states.
6. Wire routes through `withDbClient`.
7. Add minimal structured miss logging.
8. Run typecheck/lint/tests.

Acceptance criteria:

```txt
- user-state still comes from Supabase
- title/poster/year/rating in list responses come from API Postgres when cache exists
- cache miss does not fail the response
- no TMDB calls happen during list-page enrichment
- no N+1 metadata queries
```

### Phase 2: Warm-cache builder from existing TMDB rows

Files to add/modify:

- add `src/modules/watch/watch-media-card-builder.service.ts`
- possibly modify worker/job files if async refresh is added

Steps:

1. Parse media keys and identify TMDB movie/show/episode/season.
2. Load needed `tmdb_titles` / season / episode rows from API Postgres.
3. Build media-card records.
4. Upsert `watch_media_card_cache`.
5. Use builder for missing cards if source TMDB rows are already cached.

Acceptance criteria:

```txt
- missing card cache can be rebuilt from tmdb_titles without provider call
- poster/backdrop URLs match existing metadata builder conventions
- batch behavior remains one/few DB calls, not per item
```

### Phase 3: Async refresh for cold misses

Files to inspect/modify:

- `src/lib/queue.ts`
- `src/worker/index.ts`
- existing job type definitions, if any
- add refresh worker/service under `src/modules/watch/` or `src/modules/metadata/`

Steps:

1. Add job type for media-card refresh.
2. Enqueue deduped missing keys from enrichment service or route wrapper.
3. Worker parses keys.
4. Worker calls `TmdbCacheService.ensureTitleCached` where needed.
5. Worker builds/upserts `watch_media_card_cache`.
6. Add Redis lock to avoid duplicate refreshes.
7. Add metrics/logging for refresh success/failure.

Acceptance criteria:

```txt
- cold misses are eventually hydrated
- repeated page requests do not stampede TMDB
- failed provider calls do not break watch-history responses
```

### Phase 4: Latency hardening

Steps:

1. Move VPS to same/near region as Supabase when traffic justifies it.
2. Monitor endpoint p50/p95.
3. Confirm local Postgres pool sizing.
4. Confirm Supabase RPC latency.
5. Confirm no accidental direct Supabase frontend reads bypass API enrichment.

Acceptance criteria:

```txt
- 100-item warm history page stays within p95 target
- slow logs identify Supabase vs local Postgres vs serialization time
```

### Phase 5: Operations hardening

Because API Postgres owns metadata cache, protect it:

1. Automated `pg_dump` or volume snapshots.
2. Restore test.
3. Disk usage alerts.
4. Migration process documented.
5. Connection/pool limits configured.
6. Backfill/rebuild script for `watch_media_card_cache` from `tmdb_titles`.

Acceptance criteria:

```txt
- API Postgres loss is recoverable
- media-card cache can be rebuilt
- no need to upgrade Supabase solely for metadata safety
```

## Edge cases

### Supabase row has no metadata cache hit

Return fallback Supabase card. Do not fail.

### Supabase row has invalid media key

Return fallback card with media key as title if necessary. Log count only, not full user data.

### Episode history item

Prefer title-level poster from show. Keep episode-specific fields if Supabase provides them.

### Rating conflict

`RatingProductItem.rating.value` is the user's rating from Supabase. `media.rating` is metadata rating from API Postgres/TMDB/IMDb. Do not overwrite the user's rating object.

### Stale metadata

List pages should not synchronously refresh stale metadata. Detail pages can synchronously refresh.

### Multiple API instances

Do not rely on in-memory metadata cache for correctness. API Postgres and Redis must be shared between instances.

## Latency expectation

Warm 100-title page:

```txt
Supabase RPC:                 30-100ms typical
API Postgres card batch:       5-30ms typical
merge/serialization:           <5-15ms typical
total server-side target:      70-180ms typical
p95 target:                    200-400ms
```

Keeping title/poster/rating snapshots only in Supabase might save roughly `10-50ms` per page, but adds duplication/staleness and is not worth it now.

## Rollback plan

If enrichment causes issues:

1. Feature-flag route enrichment.
2. Disable enrichment and return Supabase mapped rows directly.
3. Keep mutation paths unchanged.
4. Investigate metadata cache separately.

Suggested env flag:

```txt
WATCH_SUPABASE_METADATA_ENRICHMENT=true
```

Default can be `true` after tests pass.

## Done definition

This plan is complete when:

```txt
- Supabase remains user-state only
- API Postgres provides media metadata for watch list/history/rating/state responses
- list endpoints use batched metadata lookup
- no list endpoint calls TMDB synchronously on warm path
- missing metadata does not break responses
- tests cover enrichment behavior
- lint/typecheck/test pass
- basic latency logging exists
```
