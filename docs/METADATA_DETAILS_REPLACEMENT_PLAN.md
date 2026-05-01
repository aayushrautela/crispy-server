# Metadata Details Replacement Plan

> Archived/historical plan. This document describes an older multi-provider metadata architecture, may mention provider-authority assumptions, and is not the current runtime contract. Do not implement new code from those assumptions; use `architecture.md`, `RECOMMENDATION_ENGINE_CONTRACT.md`, and `src/http/contracts/*` for the current TMDB-only model.

## Status

This document is the working migration plan for replacing the current metadata details architecture.

Current state:

- approved as a planning document only
- no implementation has started yet
- compatibility is not a goal for this migration
- cache/data migration complexity is intentionally not a blocker because the app is still early-stage

## Locked Decisions

These decisions are already made and should not be re-litigated during implementation unless product direction changes.

1. This is a proper replacement, not an additive optimization layer.
2. Compatibility with the current details API shape is not required during migration.
3. Reviews stay a separate endpoint.
4. Ratings stay a separate endpoint.
5. AI insights stay a separate endpoint.
6. Seasons and episodes are part of the core details experience and should be baked into the main details payload, similar to `aiometadata`.
7. The new design should copy the strongest parts of `aiometadata`: final-payload caching, in-flight dedupe, and warming.
8. The current detail system should be simplified and reduced, not wrapped with more route-specific layers.
9. Delete `GET /v1/metadata/titles/:mediaKey/episodes`, `GET /v1/metadata/titles/:mediaKey/next-episode`, and `GET /v1/metadata/titles/:mediaKey/seasons/:seasonNumber` entirely once the embedded main payload is in place.

## Why This Replacement Exists

The current detail system is slow because the same title metadata is rebuilt repeatedly across multiple services and routes.

Verified current problems in this repo:

- `src/http/routes/metadata.ts` splits title detail, content, reviews, ratings, seasons, episodes, and next-episode into separate routes.
- `src/modules/metadata/metadata-content.service.ts` is a separate legacy content path that rebuilds title metadata and should be treated as cleanup/removal scope for this migration.
- `src/modules/metadata/metadata-ratings.service.ts` rebuilds title metadata before loading MDBList ratings.
- `src/modules/metadata/metadata-reviews.service.ts` rebuilds provider title context before reading reviews.
- `src/modules/metadata/episode-navigation.service.ts` loads provider context and then separately rebuilds show metadata.
- `src/modules/metadata/metadata-card.service.ts`, `metadata-schedule.service.ts`, and `metadata-projection.service.ts` also reach back into live metadata context building.
- `src/modules/metadata/provider-metadata.service.ts` is the central heavy path, but it is reused ad hoc by many consumers instead of through one canonical cached result.
- current persisted metadata caches (`tmdb_titles`, `tvdb_title_bundles`, `kitsu_title_bundles`) are source caches, not final detail caches.

The practical result is:

- one title screen can trigger multiple backend requests
- each request can rebuild overlapping metadata work
- provider bundle cache hits still do a large amount of live server assembly
- show and anime details pay the heaviest cost

## Reference Model From `aiometadata`

The goal is not to copy `aiometadata`'s HTTP API exactly. The goal is to copy the parts of its architecture that make details fast.

Relevant verified patterns from `/home/aayush/Downloads/aiometadata`:

- one main meta route serves the details payload
- episodes are baked into the meta payload as `meta.videos`
- `cacheWrapMetaSmart(...)` prefers returning cached/reconstructed final metadata before rerunning heavy assembly
- in-flight requests are deduped so concurrent misses share one build
- popular/essential metadata is warmed in the background

Important product decision for this repo:

- we will copy the caching and build architecture
- we will keep reviews, ratings, and AI insights as separate endpoints
- we will still bake seasons and episodes into the main details payload because they are integral to the details experience

## Target State

The details system should become one canonical metadata product with one canonical build pipeline.

The main title details endpoint should return:

- title item
- seasons
- episodes
- next episode summary when relevant
- videos/trailers
- cast
- directors
- creators
- production info
- collection
- similar titles

The following remain separate endpoints:

- reviews
- ratings
- AI insights
- playback resolve if it remains semantically separate

The main change is not the route count. The main change is that all detail-related routes should consume one shared metadata architecture instead of each rebuilding title context independently.

## New High-Level Architecture

### 1. Metadata source layer

Purpose:

- fetch and refresh TMDB, TVDB, and Kitsu source data
- normalize raw provider results into internal source shapes
- own provider-specific refresh policy and source-cache persistence

This layer is allowed to use:

- `tmdb_titles`
- `tmdb_tv_seasons`
- `tmdb_tv_episodes`
- `tvdb_title_bundles`
- `kitsu_title_bundles`

This layer is not allowed to shape route responses.

### 2. Metadata aggregate builder

Purpose:

- take a canonical title identity plus language
- build one public details aggregate from the source layer
- include seasons and episodes in the resulting aggregate
- be the only place that assembles the main details payload

This layer replaces the current route-specific rebuilding spread across:

- `metadata-detail-core.service.ts`
- `metadata-content.service.ts`
- `metadata-ratings.service.ts`
- `metadata-reviews.service.ts`
- `episode-navigation.service.ts`
- pieces of `metadata-card.service.ts`
- pieces of `metadata-schedule.service.ts`

### 3. Metadata aggregate cache

Purpose:

- cache the final public details payload in Redis
- dedupe concurrent cache misses
- invalidate and optionally warm metadata aggregates when source data changes

This is the main architectural upgrade over the current design.

### 4. Metadata facade layer

Purpose:

- expose the new main details route
- expose smaller consumers that reuse the same aggregate or its components
- be the only route-facing entry point for core detail data

### 5. Optional viewer overlay layer

Purpose:

- attach user-specific visibility or state later if the title page needs it

For now, because reviews, ratings, and AI insights stay separate, this layer can stay minimal.

## New Contract Shape

The current `MetadataTitleDetail` contract is too narrow because seasons and episodes are split across separate routes.

The replacement should introduce a new core details contract, for example:

```ts
type MetadataTitlePage = {
  item: MetadataView;
  seasons: MetadataSeasonView[];
  episodes: MetadataEpisodeView[];
  nextEpisode: MetadataEpisodePreview | null;
  videos: MetadataVideoView[];
  cast: MetadataPersonRefView[];
  directors: MetadataPersonRefView[];
  creators: MetadataPersonRefView[];
  production: MetadataProductionInfoView;
  collection: MetadataCollectionView | null;
  similar: CatalogItem[];
};
```

Notes:

- this is intentionally the public/shared details payload
- reviews are not in this contract
- ratings are not in this contract
- AI insights are not in this contract
- the main details payload does not include MDBList content

## Route Plan

### Main route to keep and repurpose

- keep `GET /v1/metadata/titles/:mediaKey`
- change it to return the new full details payload with embedded seasons and episodes

### Routes to delete entirely

These routes should be deleted, not preserved as compatibility endpoints.

- `GET /v1/metadata/titles/:mediaKey/content`
- `GET /v1/metadata/titles/:mediaKey/episodes`
- `GET /v1/metadata/titles/:mediaKey/next-episode`
- `GET /v1/metadata/titles/:mediaKey/seasons/:seasonNumber`

Reason this is safe:

- the main title payload already embeds seasons, episodes, and `nextEpisode`
- server-side continue watching does not use these routes
- server-side calendar does not use these routes
- client does not use them directly

### Routes to keep separate

- `GET /v1/profiles/:profileId/metadata/titles/:mediaKey/reviews`
- `GET /v1/profiles/:profileId/metadata/titles/:mediaKey/ratings`
- `POST /v1/profiles/:profileId/ai/insights`

Even though these stay separate, they should eventually stop rebuilding title context independently and should consume the new canonical metadata architecture where useful.

## Cache Strategy

### Core rule

Cache the final details payload, not just provider/source inputs.

### Source caches to keep

Keep these as internal source caches:

- `tmdb_titles`
- `tmdb_tv_seasons`
- `tmdb_tv_episodes`
- `tvdb_title_bundles`
- `kitsu_title_bundles`

These remain inputs to aggregate building.

### New Redis aggregate cache

Add a new Redis keyspace for final details payloads.

Suggested namespace:

- `meta:v2:title-page:{language}:{mediaKey}`

If language is not the full cache dimension later, keying can change. The important part is a versioned namespace.

### In-flight dedupe

The aggregate cache layer must maintain an in-memory in-flight map so that concurrent misses for the same key share one build.

Required behavior:

- first request on miss starts the build
- concurrent requests for the same key await the same Promise
- successful build populates Redis
- failed build clears the in-flight entry

### Negative caching

Short negative caching is allowed for clean not-found outcomes.

Use case:

- a broken mapping or missing title should not stampede the providers on repeated requests

### Component caching

Do not start with component caching.

Phase 1 should be:

- final aggregate cache only

Phase 2 can add reusable subcomponents if needed:

- core item
- people
- videos
- season summaries
- episode list

The replacement should stay simple until the first aggregate cache is working.

## Source Layer Responsibilities

The source layer should be the only place allowed to do provider-specific work for details.

Responsibilities:

- resolve canonical title identity
- read source caches
- refresh expired source caches
- map TVDB/Kitsu source bundles into normalized provider-neutral internal source objects
- perform TMDB fallback/crosswalk logic only here

The source layer should own and centralize logic currently scattered across:

- `provider-metadata.service.ts`
- provider repo/cache services
- duplicated provider identity normalization helpers

## Aggregate Builder Responsibilities

The aggregate builder should own all public details assembly.

Responsibilities:

- build title item view
- build seasons collection
- build embedded episode list
- derive next episode
- build video list
- build cast and crew
- build production info
- build collection and similar sections

Important rules:

- one title request should build this payload once
- other routes should not re-derive these sections independently
- the builder must not be route-aware
- the builder must not hold a DB client for the entire build

## Embedded Seasons And Episodes Plan

This is a deliberate change from the current repo and aligns more closely with `aiometadata`.

### Seasons

The main payload should include all seasons relevant to the title.

For shows:

- include season summaries
- exclude unusable/special-case junk only if the current product already treats them as hidden

For anime:

- include a season projection that makes sense for the app's UI even if provider lineage is less TV-like
- do not force anime into awkward TVDB-like abstractions beyond what the existing UI needs

### Episodes

The main payload should include the episode list.

Rules:

- preserve canonical provider authority for episode identity
- provide enough data for the client to render season browsing without additional episode fetches
- ensure this is still cacheable as part of the main payload

Potential concern:

- embedding all episodes increases payload size

Decision for now:

- accept the larger payload because seasons and episodes are considered integral to the details experience
- optimize later only if real measurements show payload size becomes a problem

## Reviews, Ratings, And AI Insights

These remain separate endpoints by product decision.

### Reviews

Route stays separate.

Implications:

- it does not need to be included in the main details payload
- it can still reuse the new source layer rather than re-entering the old metadata-detail stack

### Ratings

Route stays separate.

Implications:

- MDBList is ratings-only for the app in this migration
- it can continue using MDBList data
- it should stop rebuilding metadata view just to obtain external IDs
- later it can read those IDs from the canonical title aggregate or source snapshot

### AI insights

Route stays separate.

Implications:

- keep `ai_insights_cache`
- later have `AiInsightsService` use the new canonical details payload instead of calling old detail services
- if reviews remain part of its prompt context, that dependency should point to the new review path or new source layer, not old route-facing metadata services

## DB Usage Rule

The replacement should stop the current pattern of checking out a Postgres client at the start of a request and keeping it through slow metadata assembly.

Required rule:

- DB access should happen in short scoped operations only
- no full details build should live entirely inside `withDbClient(...)`

This is especially important because the current pool is small and detail requests can self-content under parallel page loads.

## Cleanup Targets

This migration should reduce code, not increase it.

### Likely modules to delete or heavily shrink

- `src/modules/metadata/metadata-content.service.ts`
- `src/modules/metadata/metadata-ratings.service.ts`
- `src/modules/metadata/metadata-detail-core.service.ts`
- large parts of `src/modules/metadata/provider-metadata.service.ts`
- `src/modules/metadata/episode-navigation.service.ts`

### Likely modules to keep but repurpose

- TMDB/TVDB/Kitsu repo and refresh services
- identity services
- builder helper files where the pure transformation code is still useful
- Redis and queue infrastructure

### Duplication that must go away

- multiple `normalizeProviderTitleIdentity(...)` implementations
- route-specific title-context rebuilding
- route-specific title metadata view rebuilding just to extract IDs or slices of data

## Proposed New Module Layout

Suggested new metadata module structure:

- `metadata-title-source.service.ts`
- `metadata-title-aggregate.builder.ts`
- `metadata-title-cache.service.ts`
- `metadata-title-page.service.ts`
- `metadata-title-page.types.ts`
- `metadata-title-cache-keys.ts`

Then after the title-page replacement is stable:

- simplify or delete old detail services
- migrate secondary consumers to the new aggregate/source layer

## Migration Phases

### Phase 0: Contract and architecture freeze

Goal:

- lock the target route and payload shape before coding

Tasks:

- finalize the new `MetadataTitlePage` contract
- define Redis key versioning and invalidation rules
- define what counts as the canonical episode list for anime and show payloads

Exit criteria:

- contract shape is approved
- cache key strategy is approved

### Phase 1: Delete dead detail routes

Goal:

- remove dead route surface immediately now that the main title payload embeds seasons, episodes, and `nextEpisode`

Tasks:

- delete `GET /v1/metadata/titles/:mediaKey/episodes`
- delete `GET /v1/metadata/titles/:mediaKey/next-episode`
- delete `GET /v1/metadata/titles/:mediaKey/seasons/:seasonNumber`
- delete related route schemas and direct-flow tests
- delete `episode-navigation.service.ts` if no non-route consumers remain
- delete `MetadataDetailService.getSeasonDetailByShowId(...)` if no consumers remain

Exit criteria:

- the main title route is the only details route that serves seasons/episodes/nextEpisode
- no route-level code still depends on `EpisodeNavigationService`

### Phase 2: Build the new source layer

Goal:

- centralize provider/source fetching and normalization

Tasks:

- introduce a source service that resolves title identity and source inputs
- move provider-specific normalization out of route-facing services
- unify duplicated provider identity normalization logic
- preserve current source cache tables as internal caches

Exit criteria:

- one internal service can provide a normalized title source snapshot for movie, show, and anime

### Phase 3: Build the new aggregate builder

Goal:

- build the full public title payload in one place

Tasks:

- assemble title item
- assemble seasons
- assemble embedded episode list
- derive next episode
- assemble videos, people, production, collection, similar
- reuse existing pure builders where helpful

Exit criteria:

- one internal function can produce the full new details payload for movie, show, and anime

### Phase 4: Add Redis aggregate cache and in-flight dedupe

Goal:

- make repeat detail requests fast

Tasks:

- add versioned Redis keys for title-page aggregates
- add in-flight Promise dedupe
- add negative-cache policy for clean misses
- add invalidation helpers

Exit criteria:

- repeated requests hit the final aggregate cache
- concurrent cold requests for the same title share one build

### Phase 5: Swap the main details route

Goal:

- make the new aggregate the live details route

Tasks:

- change `GET /v1/metadata/titles/:mediaKey` to use the new title-page service
- update response contract schema

Exit criteria:

- one route serves the new details payload with seasons and episodes baked in

### Phase 6: Migrate separate feature endpoints onto the new internals

Goal:

- keep the separate HTTP surface for reviews, ratings, and AI while removing old internal duplication

Tasks:

- point reviews at the new source layer where practical
- point ratings at canonical IDs/external IDs from the new aggregate or source snapshot
- update AI insights to consume the new details payload instead of the old detail stack

Exit criteria:

- separate endpoints still exist
- they no longer depend on the old route-facing detail services for shared title context

### Phase 7: Delete old detail architecture

Goal:

- finish the replacement instead of leaving both systems alive

Tasks:

- delete retired services/routes/contracts
- remove duplicated normalization helpers
- remove dead code paths
- purge obsolete Redis keyspaces if any were introduced during migration

Exit criteria:

- there is only one core details architecture in the repo

## Implementation Checklist

- [ ] Finalize new `MetadataTitlePage` contract
- [ ] Add new metadata title source service
- [ ] Add new metadata title aggregate builder
- [ ] Add new metadata title cache service
- [ ] Add in-flight dedupe for title aggregate builds
- [ ] Add Redis key versioning and invalidation helpers
- [ ] Replace `GET /v1/metadata/titles/:mediaKey` with the new aggregate-backed route
- [ ] Bake seasons into the main payload
- [ ] Bake episodes into the main payload
- [ ] Bake next-episode summary into the main payload
- [ ] Delete separate season/episode/next-episode routes and related schemas/tests entirely
- [ ] Update reviews internals to stop rebuilding old detail context
- [ ] Update ratings internals to stop rebuilding old detail context
- [ ] Update AI insights internals to consume the new details payload/source layer
- [ ] Delete old detail-core architecture and duplicated helpers
- [ ] Purge old metadata aggregate cache keys if needed

## Acceptance Criteria

The replacement is complete only when all of the following are true:

- the main details route returns one canonical payload with embedded seasons and episodes
- repeat requests for the same title are served from the final aggregate cache
- concurrent requests for the same cold title trigger one build, not many
- movies, shows, and anime all use the same high-level architecture
- separate reviews, ratings, and AI endpoints remain available
- those separate endpoints no longer rebuild the old title detail stack independently
- no core details route holds a DB client through long provider/cache work
- the old split detail architecture is deleted or clearly retired
- separate season/episode/next-episode routes are deleted rather than retained as compatibility surface

## Non-Goals

The following are not goals of this migration:

- preserving current details endpoint compatibility
- keeping old route-specific detail services alive indefinitely
- minimizing code churn at the cost of retaining duplication
- solving unrelated watchlist/history/rated list performance issues in the same change

## Open Questions To Resolve Before Coding

1. Should the main payload include all episodes always, or should there be a hard cap if a title has an extreme episode count?
2. For anime with unusual provider lineage, what exact episode identity and season grouping shape should the UI consume?
3. Should the main details payload include playback-oriented fields, or should playback keep its own route-only projection?

## Working Rule For Implementation

When coding begins, implementation should follow this document in order.

If the code and this plan disagree during migration:

- prefer the replacement architecture described here
- do not preserve old service boundaries just because they already exist
- favor deletion and simplification over compatibility scaffolding
