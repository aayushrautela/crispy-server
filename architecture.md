# Crispy Server Architecture

This document is the current architecture contract for the backend.

If implementation, README examples, or older planning docs disagree, this file wins.

## Status

- current architecture contract
- TMDB-only canonical metadata identity
- no first-class backend `anime` type
- Supabase Auth plus Supabase Postgres/RPC/RLS is the user-data substrate behind Fastify
- local Postgres is metadata/cache-only, except temporary explicitly allowlisted operational outbox/admin delivery state

## System Boundary

Crispy Server owns application API/business behavior and remains the default data boundary for clients.

- API runtime: Fastify
- Worker runtime: internal BullMQ worker for backend queue jobs
- local operational database: Postgres
- user data store: Supabase Postgres/RPC/RLS behind Fastify
- queue and cache: Redis
- external auth provider: Supabase Auth
- canonical metadata provider: TMDB
- import providers: Trakt, Simkl
- AI providers: OpenAI-compatible endpoints
- external recommendation engine: event-driven service that receives recompute events and calls Crispy API

Boundary rules:

- Clients may use Supabase Auth directly for login/session.
- Normal app data calls go through Fastify, not directly to Supabase tables/RPCs.
- Fastify verifies Supabase JWTs and passes the original user access token to Supabase user-scoped RPC/Data API calls so RLS applies.
- Supabase owns persistence and RLS enforcement for all durable user/account/profile-scoped data, including identity/profile rows, preferences, secrets, PATs, provider credentials, profile watch state, history, continue watching, watchlist, ratings, provider-import interaction facts, recommendation outputs, taste profiles, and copied profile signals.
- Supabase service-role credentials are server-only and allowed only for trusted backend jobs, imports, admin repair, user-data bootstrap, private secret/token access, and upstream auth admin calls.
- Local Postgres is metadata/cache-only. It must not be the source of truth for durable user/account/profile data.
- Temporary exception: local Postgres may keep explicitly allowlisted operational delivery/admin state such as `service_outbox_events` and `admin_bulk_jobs*`; these rows must stay minimal, contain no secrets or copied signal snapshots, and are not product source-of-truth.
- Metadata authority, provider OAuth/API calls, AI vendor calls, queues, admin/ops, and recommendation orchestration stay on backend services.
- Trakt and Simkl are import sources, not canonical metadata authorities.
- The external recommendation engine receives durable recompute events from MAIN's outbox, then calls authenticated Crispy API endpoints for source data; it is not the internal BullMQ worker and does not read the application database or Supabase directly by default.

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

Recommendation generation is delegated to an external event-driven recommendation engine. MAIN emits durable recompute events through its outbox; the engine receives those events, calls authenticated Crispy API endpoints to retrieve authorized source data and configuration, and writes generated outputs back through internal app APIs. It is not this repository's internal BullMQ worker and does not read local Postgres, Redis, or Supabase directly by default.

Crispy Server owns account/profile authorization, public/internal API contracts, canonical TMDB-backed media identity, recommendation orchestration, and recommendation read/write APIs served to clients. Supabase is the persistence/RLS substrate for user data including account/profile state, interaction signals, recommendation outputs, and taste profiles. The external engine owns recommendation-generation strategy and model behavior.

## AI Model

AI features operate on the same canonical TMDB-era identity used everywhere else.

Rules:

- AI search returns `movies`, `series`, and `all`
- AI insights operate on `movie` or `show` title identities
- there is no special backend anime identity in AI flows

## Data Repair And Cleanup Rules

- prefer deletion of dead provider-only runtime branches over keeping inert compatibility code in the hot path
- do not rewrite historical migrations in place; add forward cleanup migrations instead
- local Postgres must not gain new durable user/account/profile-scoped tables; add Supabase migrations/RLS/RPCs instead
- local operational outbox/admin exceptions are temporary and must stay explicitly allowlisted

## Documentation Rules

- `architecture.md` is the system architecture source of truth.
- `README.md` is a concise project overview and quickstart, not an API inventory.
- `openapi/*.yaml` are the canonical HTTP API contracts.
- `docs/api/README.md` owns API contract workflow, classification, and quality gates.
- `docs/architecture/recommendation-engine.md` owns the recommendation-engine boundary/security narrative.
- `docs/api/media-state.md` owns client media identity guidance.
- `docs/supabase-fastify-rls-target-architecture-plan.md` owns the Supabase/Fastify/RLS architecture and watch-domain storage model.
- `docs/specs/user-data-supabase-residency.md` owns the user-data residency migration spec and local/Supabase data-boundary acceptance criteria.
- `migrations/*.sql` define the local Postgres DB contract.
- `supabase/migrations/*.sql` define the Supabase DB/RLS/RPC contract when present.
- old planning docs are historical unless explicitly marked current.

## Verification

Primary verification commands:

- `npm run typecheck`
- `npm test`
- `npm run build`
