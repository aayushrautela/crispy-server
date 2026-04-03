# Crispy Server Architecture

This document is the canonical architecture contract for the backend.

If `architecture.md`, `README.md`, older planning docs, comments, or implementation details disagree, follow this document and bring the code into alignment.

## Status

The modular monolith decoupling is complete. The codebase now has explicit module boundaries with clear ownership.

## Module Architecture

The codebase is organized into explicit modules with clear dependency direction:

```
src/modules/
├── identity/          # System-wide content identity (MediaIdentity, ContentIdentityService)
├── profiles/          # Profile ownership and access (ProfileAccessService)
├── metadata/          # Content facts, provider sync, scheduling, card/detail assembly
├── watch/             # Profile activity only (projections, raw queries, exports)
├── home/              # Home screen composition (uses WatchExportService + MetadataCardService)
├── calendar/          # Calendar composition (uses WatchExportService + MetadataCardService + MetadataScheduleService)
├── library/           # Library composition (uses WatchExportService + MetadataCardService)
├── recommendations/   # Recommendation data (uses WatchExportService + MetadataCardService)
├── integrations/       # Provider imports and connections
└── ai/                # AI features
```

### Module Boundaries

**Hard rules:**

- `metadata` module must never import from `watch` module
- `watch` module must never import metadata provider/cache internals
- `watch` module returns raw activity data, not metadata-hydrated views
- No two-way dependency between `metadata` and `watch` modules

**Public service boundaries:**

- `WatchQueryService` - Raw watch data reads (no metadata hydration)
- `WatchExportService` - Public read boundary for other modules
- `MetadataCardService` - Card view boundary (watch uses this, not the rich detail core)
- `MetadataProjectionService` - Projection building (watch uses this)
- `MetadataScheduleService` - Next/upcoming episode logic
- `ProfileAccessService` - Centralized ownership verification

**Module responsibilities:**

- `identity`: System-wide content identity language (MediaIdentity, parseMediaKey, inferMediaIdentity)
- `metadata`: Content facts, provider sync, scheduling, card/detail assembly, provider metadata
- `watch`: Profile activity (watch events, progress, history, continue watching, watchlist, ratings, tracked series)
- `surfaces` (home, calendar, library): Composed read surfaces that delegate to watch and metadata services

## System Boundary

Crispy Server is a backend service that owns application logic and application data.

- API runtime: Fastify
- Worker runtime: BullMQ worker
- Primary database: Postgres
- Queue and cache: Redis
- External auth provider: Supabase auth only
- Metadata providers: TMDB, TVDB, Kitsu
- Import providers: Trakt, Simkl
- AI providers: OpenAI-compatible endpoints

Non-negotiable boundary rules:

- Supabase is used for auth only.
- Supabase is not the application database.
- Supabase is not used here for RLS, Storage, Edge Functions, or Realtime application data.
- Application state, watch data, metadata state, imports, and recommendations live on our server.

## Runtime Components

- `src/bin/api.ts` starts the HTTP API.
- `src/bin/worker.ts` starts the background worker.
- `src/http/app.ts` assembles the route surface.
- `src/worker/index.ts` dispatches background jobs.
- `migrations/` defines the Postgres schema.

Operational source-of-truth files:

- `architecture.md` for architecture rules and invariants
- `README.md` for stack summary and endpoint map
- `src/http/app.ts` and `src/http/routes/*.ts` for the actual API surface
- `migrations/*.sql` for the DB contract

## Auth And Ownership

The signed-in account is the only auth actor.

- Bearer JWTs are verified by the backend against the external auth provider JWKS.
- Local PATs starting with `cp_pat_` are issued and validated by this backend.
- Internal service auth uses `x-service-id` and `x-api-key`.

Ownership model:

- One authenticated account owns one or more profiles.
- Profiles are child personas under the account.
- Profiles do not have separate bearer tokens, PATs, or service credentials.
- Account-scoped data includes account settings, PATs, AI API key, metadata-enrichment availability flags, and account lifecycle.
- Profile-scoped data includes watch state, history, continue watching, ratings, watchlist, provider connections, imports, taste, and recommendations.
- Trakt and Simkl connections are per-profile.

## Core Identity Model

There are two distinct identity systems, and they must not be conflated.

### 1. Canonical metadata identity

- `content_items.id` is the canonical metadata identifier.
- This UUID is referred to as `content_id` in DB discussions and remains internal to metadata/storage workflows.
- `content_provider_refs` stores provider mappings for a canonical content row.

Rules:

- `content_id` identifies metadata entities.
- `content_id` is the canonical metadata row id for internal persistence and canonical joins.
- Public metadata title routes must use title `mediaKey` values so clients do not depend on internal UUIDs.
- `content_id` is not the watch-state lookup contract.

### 2. Canonical watch identity

- `mediaKey` is the canonical watch-state and event identity.

Rules:

- `mediaKey` is used for watch-state reads and writes.
- `mediaKey` is used for watchlist, rating, watched-state, progress, history, and continue-watching logic.
- `mediaKey` is a watch-domain key, not the canonical metadata row id.

### Identity separation rule

- Metadata flows use `content_id` internally, but public title detail/content routes accept only title `mediaKey` values at the boundary.
- Watch flows resolve through `mediaKey`.
- Public routes should expose one stable client identity whenever possible.

## Canonical Entity Types

The canonical entity types are:

- `movie`
- `show`
- `anime`
- `season`
- `episode`
- `person`

Entity purity rule:

- A title `content_id` must map to title refs only.
- A season `content_id` must map to season refs only.
- An episode `content_id` must map to episode refs only.
- A `content_id` must never be treated as multiple entity kinds based on row ordering.

This means a title endpoint must never resolve an episode-backed canonical row and then try to normalize it into a title.

## Provider Authority Matrix

Provider authority is fixed by media family.

| entity type | authority provider |
| --- | --- |
| `movie` | `tmdb` |
| `show` | `tvdb` |
| `anime` | `kitsu` |
| `season` under show | `tvdb` |
| `season` under anime | `kitsu` |
| `episode` under show | `tvdb` |
| `episode` under anime | `kitsu` |
| `person` | `tmdb` for now |

Rules:

- Movies canonicalize to TMDB authority.
- Non-anime series canonicalize to TVDB authority.
- Anime canonicalizes to Kitsu authority.
- Child entities inherit authority from the parent title lineage.
- Alternate provider ids are useful crosswalks, but they do not change canonical authority.

## Media Identity Shape

The backend must use a provider-aware identity shape rather than a TMDB-shaped assumption set.

Minimum logical fields:

- `mediaKey`
- `mediaType`
- `provider`
- `providerId`
- `parentProvider`
- `parentProviderId`
- `seasonNumber`
- `episodeNumber`
- `absoluteEpisodeNumber`

Rules:

- Title identities require explicit authority-provider identity.
- Season identities require parent identity plus season coordinates.
- Episode identities require parent identity plus episode coordinates.
- Sparse inference is not a supported architecture goal.
- If identity cannot be built deterministically, fail clearly instead of guessing.

## Canonical Metadata Rules

`content_provider_refs` is the system of record for external mappings.

Rules:

- Authority refs are primary.
- Alternate refs attach to an existing canonical row when they describe the same logical entity.
- If two canonical rows are discovered to represent the same logical entity, repair or rebuild the canonical mapping instead of leaving duplicates in place.
- Reverse resolution from `content_id` must use explicit entity-kind and authority rules, not DB row ordering.

Important anti-rule:

- Do not select the effective entity type from the first `content_provider_refs` row.

## Public API Contracts

### Metadata API

Metadata title routes accept stable public title identity.

- `GET /v1/metadata/titles/:mediaKey`
- `GET /v1/metadata/titles/:mediaKey/content`
- `GET /v1/metadata/titles/:mediaKey/seasons/:seasonNumber`

Rules:

- `:mediaKey` must be a title `mediaKey` (`movie:*`, `show:*`, `anime:*`).
- Title routes accept title identities only.
- Title routes must not silently reinterpret other identities as title ids.
- Title routes must reject season, episode, and person `mediaKey` values.
- Metadata enrichment and provider fetches must resolve from the title's authority provider.

### Watch API

Watch routes operate on canonical watch identity.

Examples:

- `GET /v1/profiles/:profileId/watch/state`
- `POST /v1/profiles/:profileId/watch/states`
- `PUT /v1/profiles/:profileId/watch/watchlist/:mediaKey`
- `PUT /v1/profiles/:profileId/watch/rating/:mediaKey`

Rules:

- Watch-state lookup should require `mediaKey`.
- Watchlist and rating mutations should use `mediaKey`.
- Public watch routes should not depend on sparse provider inference where a canonical `mediaKey` already exists in metadata payloads.
- Request parsing must reject string sentinel garbage like `null` or `undefined` when a field is optional.

### Resolve API

Resolve-style endpoints may accept convenience provider ids, but canonical output must still follow authority rules.

Rules:

- Explicit `mediaType` beats heuristics.
- Convenience ids like `tmdbId`, `tvdbId`, or `kitsuId` can be accepted at the boundary.
- Canonical output must normalize to stable provider-aware identity.
- If resolution remains ambiguous, return an error instead of persisting unstable identity.

## Search Model

Title search is provider-routed by media family.

Rules:

- `movies` search resolves through TMDB.
- `series` search resolves through TVDB.
- `anime` search resolves through Kitsu.
- mixed search may fan out across all providers and merge results.

Requirements:

- `anime` is first-class in both schema and code.
- Search filters must not rely on TMDB-only discovery assumptions when the selected family is `series` or `anime`.
- Canonical search results must materialize clean canonical content ids for the routed provider family.

## Watch Storage Rules

User watch data must be anchored to canonical watch identity and remain reconcilable with metadata identity.

Rules:

- `mediaKey` is the main watch-domain storage key.
- `content_id` may be denormalized onto watch-domain tables if needed later, but the architecture must not depend on TMDB-only columns as the primary identity model.
- Continue-watching and history projections must canonicalize child activity consistently so the same logical show or anime does not appear as multiple entries because of identity drift.

## Home And Calendar Rules

Home and calendar are derived surfaces built from watch state and metadata identity.

Rules:

- Calendar item identity construction must be explicit for title, season, and episode records.
- Episode calendar items must use correct parent-title authority.
- Home must not depend on TMDB-only assumptions for show or anime lineage.

## Library Model

The product has four native personal library concepts:

- `continueWatching`
- `history`
- `watchlist`
- `ratings`

There is no separate native `collection` concept.

Rules:

- Local canonical library state includes watchlist and ratings, not a distinct collection list.
- Provider-specific collection-like concepts should be normalized into canonical watchlist semantics.
- We do not preserve separate provider `collection` as a first-class surfaced product concept.
- TMDB metadata `collection` remains a movie-franchise metadata concept and is unrelated to user library state.

Implication:

- Trakt `collection` may be fetched as provider input, but it should not survive as a separate canonical library concept.

## Import Model

Provider imports normalize provider data into canonical metadata identity and canonical watch identity.

Rules:

- Trakt and Simkl are source providers, not authority providers.
- Imports should resolve movies to TMDB, shows to TVDB, and anime to Kitsu.
- If provider data cannot be resolved confidently to canonical authority, surface unresolved import work instead of forcing a bad canonical mapping.
- Import logic must not collapse anime into generic show handling when anime-specific authority is available.

## AI Model

AI features consume canonical app identity through the public service boundaries.

Target rules:

- AI title-oriented features accept title `mediaKey` through public service boundaries.
- AI search resolves through `TitleSearchService`, and AI insights resolve rich metadata through `MetadataDetailService` and `MetadataDetailCoreService`.
- AI route behavior aligns with the same movie/show/anime authority model used everywhere else.

## Data Repair And Migration Rules

Canonical metadata UUID churn during migration is acceptable.

Rules:

- Do not add legacy compatibility branches to preserve broken identity behavior.
- Do not keep dormant fallback logic after the canonical model is corrected.
- Prefer destructive canonical rebuild over fragile in-place repair when the rebuild is simpler and safer.

## Documentation Rules

To prevent future drift:

- Update `architecture.md` first when the architecture contract changes.
- Keep `README.md` aligned at the summary and endpoint-map level.
- Treat older planning docs as historical unless they are brought into alignment with this document.
- Do not encode architecture decisions only in tests, comments, or migration names.

## Verification Rules

This repository verifies through the Node and TypeScript toolchain.

- `npm run typecheck`
- `npm test`
- `npm run build`

## New Service Reference

Key services created during decoupling:

- `WatchQueryService` (`src/modules/watch/watch-query.service.ts`) - Raw watch data reads without metadata hydration
- `WatchExportService` (`src/modules/watch/watch-export.service.ts`) - Public read boundary for other modules
- `MetadataCardService` (`src/modules/metadata/metadata-card.service.ts`) - Card view boundary
- `MetadataProjectionService` (`src/modules/metadata/metadata-projection.service.ts`) - Projection building for watch events
- `MetadataScheduleService` (`src/modules/metadata/metadata-schedule.service.ts`) - Next/upcoming episode logic
- `ProfileAccessService` (`src/modules/profiles/profile-access.service.ts`) - Centralized ownership verification

Gradle is not part of this repo's verification path and is not installed in this environment.
