# Crispy Server Architecture

This document is the current architecture contract for the backend.

If implementation, README examples, or older planning docs disagree, this file wins.

## Status

- current runtime model
- TMDB-only canonical metadata identity
- no first-class backend `anime` type
- older provider-authority planning docs are historical only

## System Boundary

Crispy Server owns application logic and application data.

- API runtime: Fastify
- Worker runtime: internal BullMQ worker for backend queue jobs
- primary database: Postgres
- queue and cache: Redis
- external auth provider: Supabase auth only
- canonical metadata provider: TMDB
- import providers: Trakt, Simkl
- AI providers: OpenAI-compatible endpoints
- external recommendation engine: pull-based service that calls Crispy API

Boundary rules:

- Supabase is used for auth only.
- Supabase is not the application database.
- Application state, watch data, metadata state, imports, and recommendations live on our server.
- Trakt and Simkl are import sources, not canonical metadata authorities.
- The external recommendation engine calls authenticated Crispy API endpoints for source data; it is not the internal BullMQ worker and does not read the application database directly.

## Module Layout

`src/modules/` is organized into explicit modules:

- `identity` - canonical media keys and content identity
- `profiles` - account/profile ownership and access
- `metadata` - TMDB metadata, detail assembly, scheduling, card/detail projections
- `watch` - profile watch state, read models, and event ingestion
- `calendar` - derived calendar surfaces
- `recommendations` - stored recommendation snapshots, read models, and API integration surfaces for the external engine
- `integrations` - Trakt/Simkl imports and connections
- `ai` - AI search and insights

Hard rules:

- `metadata` must not depend on `watch` internals for canonical metadata identity.
- `watch` must not depend on removed provider caches or provider authority routing.
- public read surfaces should compose watch state with metadata views, not invent alternate identity schemes.

## Identity Model

There are two distinct identity systems.

### Internal metadata identity

- `content_items.id` is the internal canonical metadata identifier.
- `content_provider_refs` maps canonical metadata rows to external references.

### Public watch/navigation identity

- `mediaKey` is the public and watch-domain identity.
- watch-state reads, writes, history, watchlist, ratings, continue watching, and episodic follow all resolve through `mediaKey`.

Current canonical media types:

- `movie`
- `show`
- `season`
- `episode`
- `person`

Removed backend type:

- `anime`

Anime-origin titles are modeled as ordinary TMDB `movie` or `show` content.

## Canonical Provider Rules

Canonical media identity is TMDB-only.

Rules:

- title identities resolve to TMDB ids
- season and episode identities resolve from a TMDB show id plus coordinates
- public metadata and playback resolution accept TMDB-backed identities directly
- TVDB/Kitsu are not canonical authorities anywhere in runtime identity

Canonical media key shapes:

- `movie:tmdb:{tmdbId}`
- `show:tmdb:{tmdbId}`
- `season:tmdb:{showTmdbId}:{seasonNumber}`
- `episode:tmdb:{showTmdbId}:{seasonNumber}:{episodeNumber}`
- `person:tmdb:{tmdbId}`

## Metadata Model

Metadata is TMDB-first.

Rules:

- title detail, playback resolution, scheduling, and search all resolve through TMDB
- metadata runtime does not route by media family to TVDB or Kitsu
- external ids surfaced in metadata responses are currently `{ tmdb, imdb, tvdb }`
- `tvdb` remains only as a compatibility crosswalk where TMDB or Trakt lookups benefit from it

Search model:

- `movies` search -> TMDB movie search
- `series` search -> TMDB TV search
- `all` search -> TMDB movie + TV search
- there is no first-class backend `anime` search bucket

## Watch Model

Watch storage is anchored to canonical TMDB-era media keys.

Rules:

- continue watching, history, watchlist, ratings, and watch state are `mediaKey`-based
- title projections are `movie` or `show`
- episodic follow tracks shows only
- watched-title expansion uses TMDB episode listings, not removed provider-context episode bundles

## Import Model

Trakt and Simkl are source systems.

Rules:

- imports normalize source data into TMDB-backed `movie` and `show` identities
- unresolved imports should be surfaced rather than forced into bad canonical mappings
- legacy provider/source bookkeeping may still appear in import history objects, but canonical runtime identity remains TMDB-only

## Recommendation Model

Recommendation generation is delegated to an external pull-based recommendation engine. The engine calls authenticated Crispy API endpoints to retrieve authorized source data and configuration. It is not this repository's internal BullMQ worker and does not read the application database directly.

Crispy Server owns account/profile authorization, watch and rating data, canonical TMDB-backed media identity, and stored recommendation snapshots served to clients. The external engine owns recommendation-generation strategy and model behavior.

## AI Model

AI features operate on the same canonical TMDB-era identity used everywhere else.

Rules:

- AI search returns `movies`, `series`, and `all`
- AI insights operate on `movie` or `show` title identities
- there is no special backend anime identity in AI flows

## Data Repair And Cleanup Rules

- prefer deletion of dead provider-only runtime branches over keeping inert compatibility code in the hot path
- do not rewrite historical migrations in place; add forward cleanup migrations instead
- older planning docs should be clearly marked historical if they describe removed models

## Documentation Rules

- `architecture.md` is the architecture source of truth
- `README.md` is the stack and endpoint summary
- `src/http/contracts/*` define the concrete HTTP payload contract
- `migrations/*.sql` define the DB contract
- old planning docs are historical unless explicitly marked current

## Verification

Primary verification commands:

- `npm run typecheck`
- `npm test`
- `npm run build`
