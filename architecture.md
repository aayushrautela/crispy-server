# Crispy Server Architecture

This document is the current architecture contract for the backend.

If implementation, README examples, or older planning docs disagree, this file wins.

## Status

- current architecture contract
- TMDB-only canonical metadata identity
- no first-class backend `anime` type
- Supabase Auth is the external identity/session provider
- local Postgres is the product data and metadata/cache store

## System Boundary

Crispy Server owns application API/business behavior and remains the default data boundary for clients.

- API runtime: Fastify
- Worker runtime: internal BullMQ worker for backend queue jobs
- local product database: Postgres
- queue and cache: Redis
- external auth provider: Supabase Auth
- canonical metadata provider: TMDB
- import providers: Trakt, Simkl
- AI providers: OpenAI-compatible endpoints
- external recommendation engine: event-driven service that receives recompute events and calls Crispy API

Boundary rules:

- Clients may use Supabase Auth directly for login/session.
- Normal app data calls go through Fastify.
- Fastify verifies Supabase JWTs and authorizes access to local account/profile data.
- Local Postgres owns persistence for durable product data, including identity/profile rows, preferences, secrets, PATs, provider credentials, profile watch state, history, continue watching, watchlist, ratings, provider-import interaction facts, recommendation outputs, taste profiles, and copied profile signals.
- Supabase service-role credentials are server-only and allowed only for upstream auth admin calls when required.
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

## Profile Model

Each profile is a child persona under exactly one account. The first profile on an account is the **admin (main) profile** (`is_admin = true`); at most one admin profile per account is enforced by a partial unique index. Subsequent profiles are non-admin.

Admin profiles are the only place account-scoped operations surface — addon configuration, profile roster management, AI key administration, account deletion, and the optional `require_pin_to_add_profiles` policy live on the admin profile.

### Per-profile PIN

Every profile (admin included) may set a 4-digit PIN. Storage:

- `pin_hash` bcrypt (cost 10) — never plaintext.
- `pin_failed_attempts` + `pin_locked_until` for exponential brute-force back-off (5 wrong → 30s, 10 → 5m, doubling, capped at 1h).
- Verify returns `valid: boolean`, `lockedUntil: ISO | null`, `remainingAttemptsBeforeLockout: number`.

When the admin profile has `require_pin_to_add_profiles = true`, every `POST /v1/profiles` call must include a valid `adminPin` matched against the admin profile's PIN.

#### Profile unlock (Redis session)

A successful `verifyPin` sets a Redis-backed unlock flag for the profile + authenticated user: key `profile_unlock:{profileId}:{authSubject}` with a 30-day TTL. This mirrors the Netflix model — verify the PIN once and stay unlocked until the user explicitly locks or logs out; the client does NOT need to present any per-request token.

Profile-scoped read/write routes (currently `/v1/profiles/:profileId/watch/*`, `/v1/profiles/:profileId/ai/*`, `/v1/profiles/:profileId/calendar*`) enforce the `requireProfileUnlock` guard when the target profile has a PIN set:

- Profile locked (no unlock flag) → `423 PROFILE_LOCKED`.
- Profile has no PIN → routes are open.

`POST /v1/profiles/:profileId/lock` clears the unlock flag for the authenticated user, forcing PIN re-verification on the next gated request. Setting, changing, or removing a PIN also clears the unlock flag (force re-verify with the new/changed PIN). The unlock state lives server-side in Redis; clients never handle tokens.

### Standardized language and country

`interface_language` and country code values are validated against code-only allowlists: `src/modules/i18n/supported-languages.ts` (BCP-47 short list) and `src/modules/i18n/supported-countries.ts` (ISO-3166-1 alpha-2). Clients fetch the canonical catalogs via:

- `GET /v1/i18n/languages`
- `GET /v1/i18n/countries`

These endpoints are the source of truth for any UI rendering signup, profile-edit, or onboarding dropdowns.

### Avatar URL

`identity.profiles.avatar_url` stores a built-in avatar id (e.g. `toon_1` or `vibrent_7`). The catalog and validation live in `src/modules/profiles/avatars.ts` (`SUPPORTED_AVATARS`); only those ids are accepted on write. Images are static files under `assets/avatars/<id>.png` and are served publicly at `GET /v1/avatars/:id` with long-lived cache headers. The backend stores and validates the id only; avatar selection is mandatory on signup and when creating a profile.

### Strict signup bootstrap

The first authenticated request bootstraps the account and its admin profile. Required profile fields are enforced at that point via `src/http/auth-helpers.ts` `verifyAndUpsertAuthJwt`:

- `name` is required (derived from token `full_name`/`name`/`display_name`, else the email local-part).
- `interfaceLanguage` is required and must be a supported language code.
- `avatarUrl` is required and must be one of the built-in avatar ids (`SUPPORTED_AVATARS` in `src/modules/profiles/avatars.ts`).

If any required field is missing or invalid, the request is rejected with `409 signup_incomplete` and a `fields` list; the admin profile is not created until the client supplies complete metadata (e.g. via Supabase user metadata). Once a profile exists, subsequent requests succeed.

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

### Real-time continue-watching sync

Continue-watching is cross-device: a user may watch on one client (e.g. TV) and expect the
row to update on another (e.g. phone/web). Watch-state writes are the source of truth; clients
are notified via a push invalidation channel, not polling.

- The canonical writers `LocalUserWatchService.recordPlaybackState` and `dismissContinueWatching`
  publish a lightweight invalidation (never the payload) over Redis pub/sub channel `cw:{accountId}`
  after their DB commit, via `modules/watch/watch-change.publisher.ts`.
- Progress ticks are debounced per profile (`cw-dirty:{accountId}:{profileId}`, ~5s window) so a
  long playback session cannot flood Redis; `playback_completed` and dismiss bypass the debounce.
- `GET /v1/profiles/:profileId/watch/stream` is an SSE endpoint sharing the same auth +
  profile-unlock guard as the other watch routes. It subscribes (per-account, only while a client
  is connected) to `cw:{accountId}`, filters by `profileId`, heartbeats every 30s, enforces a
  per-profile connection cap, and cleans up on disconnect. The client refetches the
  continue-watching page on each `watch_changed` event; the DB remains authoritative, so a missed
  event during disconnect is self-healing on reconnect.

## Import Model

Trakt and Simkl are source systems.

Rules:

- imports normalize source data into TMDB-backed `movie` and `show` identities
- unresolved imports should be surfaced rather than forced into bad canonical mappings
- legacy provider/source bookkeeping may still appear in import history objects, but canonical runtime identity remains TMDB-only

## Recommendation Model

Recommendation generation is delegated to an external event-driven recommendation engine. MAIN emits durable recompute events through its outbox; the engine receives those events, calls authenticated Crispy API endpoints to retrieve authorized source data and configuration, and writes generated outputs back through internal app APIs. It is not this repository's internal BullMQ worker and does not read local Postgres, Redis, or Supabase directly by default.

Crispy Server owns account/profile authorization, public/internal API contracts, canonical TMDB-backed media identity, recommendation orchestration, and recommendation read/write APIs served to clients. Local Postgres is the persistence substrate for product data including account/profile state, interaction signals, recommendation outputs, and taste profiles. Supabase is the external auth provider only. The external engine owns recommendation-generation strategy and model behavior.

## AI Model

AI features operate on the same canonical TMDB-era identity used everywhere else.

Rules:

- AI search returns `movies`, `series`, and `all`
- AI insights operate on `movie` or `show` title identities
- there is no special backend anime identity in AI flows

## Data Repair And Cleanup Rules

- prefer deletion of dead provider-only runtime branches over keeping inert compatibility code in the hot path
- do not rewrite historical migrations in place; add forward cleanup migrations instead
- product schema changes belong in the local migration workflow
- do not reintroduce Supabase app-data repositories, RPCs, RLS policies, or PostgREST paths

## Documentation Rules

- `architecture.md` is the system architecture source of truth.
- `README.md` is a concise project overview and quickstart, not an API inventory.
- `openapi/*.yaml` are the canonical HTTP API contracts.
- `docs/api/README.md` owns API contract workflow, classification, and quality gates.
- `docs/architecture/recommendation-engine.md` owns the recommendation-engine boundary/security narrative.
- `docs/api/media-state.md` owns client media identity guidance.
- `docs/specs/client-reco-pipeline-spec.md` owns the client home and RECO DTO contract split.
- `migrations/*.sql` define the local Postgres DB contract.
- `supabase/README.md` documents the remaining Supabase auth-only boundary.

## Verification

Primary verification commands:

- `npm run typecheck`
- `npm test`
- `npm run build`
