# Recommendation engine boundary

## Status

Target architecture and security contract for integration between Crispy Server (MAIN) and the external recommendation engine (RECO).

> Note: Crispy Server no longer ships `RecoItemRef` or any signal-bundle type. The per-signal read routes return `ClientMediaCard[]` (the same fully-enriched card shape the public `/v1/profiles/:profileId/watch/*` and `/v1/profiles/:profileId/home` routes return). RECO's worker applies a single `cardToRecoInput` helper that reads `itemId` + `mediaType` off each card; there is no `CatalogService`, no `signal_bundle_mapper`/`signal_assembler`, and no `ProviderIds.Tmdb` re-resolution on the reco side. The contract below describes RECO-side behavior; Crispy-Server-side types refer to `RecoWriteItem` (in `src/modules/recommendations/reco-contract.types.ts`) for the *write* side and `ClientMediaCard` for the *read* side.

OpenAPI remains the machine-readable source of truth for exact endpoint shapes, status codes, examples, and error envelopes:

- `openapi/internal-services.v1.yaml` for RECO calls into MAIN internal app and AI-plan APIs.
- `openapi/internal-recommender.v1.yaml` for MAIN service-outbox calls into RECO event ingestion.
- `openapi/admin-ops.v1.yaml` for admin recompute and diagnostics.
- `docs/api/recommendations.md` for human-facing recommendation API and operator guidance.
- `docs/specs/client-reco-pipeline-spec.md` for target DTO shapes.

## Ownership boundary

| Area | Owner |
| --- | --- |
| Account/profile ownership and authorization | Crispy API Server + Supabase auth boundary behind Fastify |
| Watch history, ratings, watchlist, continue watching, episodic follow | Crispy API Server |
| Canonical media identity and provider refs | Crispy API Server |
| Public client recommendation cards | Crispy API Server |
| Stored recommendation lists and snapshots | Crispy API Server |
| Recommendation model logic and generation strategy | External recommendation engine |
| Pulling eligible source data after recompute events | External recommendation engine through Crispy API |
| Internal queue jobs in this repository | Crispy Server BullMQ worker |

RECO is not this repository's BullMQ worker and must not read Crispy Server Postgres, Supabase, Redis, or local runtime state directly by default.

## Authentication

MAIN uses one auth framework for all service-to-service identity. The same
framework governs the two home ingest pipeline producers (`reco`,
`custom`), and is the sole source of principal shape. The shared `default`
home is **not** a producer — it is a server-internal artifact built from
managed templates and cached in Redis; it never authenticates or calls the
ingest endpoint.

| Producer | App identity | Auth mechanism | Scope of access |
| --- | --- | --- | --- |
| `reco` | `app_registry.app_id = 'reco'` | Bearer token verified against `RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH` env var (legacy single-token mechanism preserved for operational continuity; principal resolved from `app_registry` / `app_scopes` / `app_grants` / `app_source_ownership` rows on match) | system-wide: any profile's signals read, any profile's home lists write |
| `custom` | `app_registry.app_id = 'custom'` (registry-only; no `app_keys` row) | Bearer PAT (`cp_pat_...`) issued by the user, with the `recommendations:write` scope | per-user only: the URL `:accountId` must match the PAT owner's `appUserId`; ownership enforced at the home-list-upsert route |

### Service principal resolution (reco)

RECO authenticates to MAIN with:

```text
Authorization: Bearer <raw token whose SHA-256 hash matches RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH>
```

On match, the auth plugin resolves the principal for `app_id='reco'` from DB rows
(same rows `DefaultAppAuthService.buildPrincipal` would use for an AppKey).
This eliminates the prior `buildOfficialRecommenderPrincipal` hard-coded
principal; the DB rows registered in migration `0022_register_home_ingest_apps`
are the single source of truth.

### Per-user principal resolution (custom)

Custom services do NOT authenticate as a service principal. They authenticate
with a PAT (Personal Access Token, prefix `cp_pat_`) issued by the user whose
home they push to. The PAT must carry the `recommendations:write` scope
(this scope is already in `PAT_ALLOWED_SCOPES`). The upsert route synthesizes
an `AppPrincipal` for `appId='custom'` from the PAT-authenticated user actor
and enforces that the URL `:accountId` equals the PAT owner's `appUserId` —
custom can only push the caller's own home. System-wide scopes are never
granted to PATs.

### MAIN to RECO

MAIN's service-outbox dispatcher authenticates to RECO event ingestion with:

```text
Authorization: Bearer <MAIN_TO_RECOMMENDER_SERVICE_TOKEN>
```

RECO validates this token by comparing its SHA-256 hash with `MAIN_TO_RECOMMENDER_SERVICE_TOKEN_HASH`.

## Event dispatch and ingestion

MAIN emits durable recommendation recompute requests as `service_outbox_events` rows. The outbox dispatcher posts event envelopes to RECO's inbound event-ingestion endpoint.

Current event type:

```text
recommendation.recompute_requested
```

Current runtime recompute reasons:

```text
watch_history_changed
rating_changed
watchlist_changed
playback_progress_changed
profile_created
profile_settings_changed
admin_requested
```

`admin_requested` is the current reason for admin-triggered recompute requests.

Dispatcher response handling:

- `2xx`: success; MAIN can mark the service-outbox row dispatched.
- `409 Conflict`: duplicate receipt; MAIN treats this as idempotent success.
- `400 Bad Request`: permanent schema/validation failure; do not retry unchanged.
- `401 Unauthorized` or `403 Forbidden`: permanent auth/configuration failure until credentials or authorization are fixed.
- `5xx`, network errors, and timeouts: transient; retry according to MAIN's service-outbox retry policy.

The current RECO ingestion response acknowledges acceptance and may include only a RECO event id. It does not return generation progress or a durable generation job id to MAIN.

## Source data and AI generation flow

RECO retrieves bounded, authorized machine inputs through MAIN internal APIs. Per the per-signal refactor, MAIN no longer exposes a single bundle endpoint; RECO issues parallel `GET` requests against the per-signal read routes (history, ratings, watchlist, continue-watching, episodic-follow, taste) plus a `profile-meta` route that returns profile-scoped fields (profileName, isKids, language, region, watchDataOrigin) for `GenerateRequest.profileContext` assembly, plus the eligibility decision. MAIN runs the **same read-time card-enrichment pass** for every per-signal route as it runs for the public `/v1` watch and `/home` routes.

Each watch signal route returns `ClientMediaCard[]` — the same fully-enriched card shape the public `/v1/profiles/:profileId/watch/*` and `/v1/profiles/:profileId/home` routes return. There is no `BaseItemDtoQueryResult` envelope and no raw `BaseItemDto` on the wire downstream of MAIN.

**Single enrichment pass:** MAIN materializes `ClientMediaCard` (canonical `itemId`, `mediaType`, `title`, `overview`, `year`, `images`, `trailerUrl`, `progress`, `parent`) for every read path — public client app, admin, reco worker, and reco webui. The reco worker reads `itemId` + `mediaType` directly off each card; the reco webui renders the cards as-is. No consumer runs a `CatalogService` pass, looks up TMDB metadata by `ProviderIds.Tmdb`, or overlays display fields per row.

RECO's `cardToRecoInput` helper reads each card's `itemId` and normalizes `mediaType` (mapping `season`/`episode` to `tv`, `movie` to `movie`) into the tuple `GenerateRequest` expects. The locally-assembled bundle never travels on the wire, and no `ProviderIds`/`Type`/`UserData` extraction step exists.

Signal records that RECO constructs from these reads carry canonical-item + media-type values with:

- `itemId` (the canonical Crispy public item id)
- media `type` (`movie` or `tv`)

Signal records do not carry raw `BaseItemDto`, client `UserData`, `ProviderIds`, `Type` (PascalCase), titles (the worker does not echo card display fields back in its write payload), original titles, years, release dates, posters, backdrops, logos, trailers, or enriched display card payloads back to MAIN's write side.

AI-assisted generation is owned entirely by RECO. MAIN does not expose an AI-plan endpoint and never sees provider credentials, model selection, prompts, or raw vendor traffic for recommendations.

1. RECO prepares business inputs, a bounded TMDB-backed candidate pool, list key, algorithm version, and generation context using the canonical `itemId`s it received on the read side.
2. RECO selects the AI provider/model and uses its own server-funded API key (`RECO_AI_API_KEY`, `RECO_AI_ENDPOINT_URL`, `RECO_AI_MODEL`) to call the OpenAI-compatible vendor directly from the worker process.
3. RECO builds the prompt, calls the vendor, parses and validates the response against the candidate pool, and resolves titles.
4. On any AI error or when AI is disabled, RECO falls back to deterministic TMDB trending/popular/top-rated lists.
5. RECO uses the typed plan to assemble final recommendation lists and writes generated outputs back through internal app recommendation write endpoints.

RECO must not request, receive, cache, log, or forward raw account BYOK keys. MAIN keeps its own server-funded key only for non-recommendation AI features (`ai search`, `ai insights`).

## Result publication

Generated outputs are published back through internal app recommendation write endpoints. RECO writes list metadata plus ordered provider identities.

See "Home ingest pipeline" below for the unified producer contract (reco, custom) and the transform/write path. The same endpoint and request shape are reused for every source; only the `source` field on the stored snapshot distinguishes provenance.

RECO must not send nested identity wrappers, enriched card payloads, `ClientMediaCard`, `BaseItemDto`, artwork, descriptions, storage `contentId`, media keys, write-mode fields, eligibility versions, or arbitrary unbounded metadata. The write side carries only `RecoWriteItem` (provider refs + `type`); the read-side card shape never reaches the write side.

Result ingestion is idempotent by profile, list key, and idempotency key where documented.

## Public client output

Public recommendation home responses are client-card responses, not RECO payloads and not `BaseItemDto` lists.

Each section has:

- `listKey`
- `title`
- `subtitle`
- `sectionType`
- `items`
- `meta`

Each item is a UI-ready card with canonical `itemId`, display fields, artwork, and watch progress. Normal client cards do not expose provider refs, provider IDs, scores, reason codes, model details, or storage internals.

## Sensitive data and logging

RECO logs should avoid raw watch/rating payload retention and should include account/profile identifiers only when operationally necessary. Never log API keys, user access tokens, provider refresh tokens, bearer tokens, service API keys, AI provider/model/endpoint/proxy configuration, raw prompts, raw vendor request/response payloads, or confidential configuration.

## Home ingest pipeline

The home screen is recommendations. Client apps call `GET /home` and read back
whatever was previously written; the read path does not call external services
on-the-fly. A home is **stored per `(profile, source)` as a single atomic
snapshot** — every write replaces every active rail for that source at once.
The read response always carries rails from **one** source only; sources are
never mixed.

### Producers and sources

Two producers push into the home store (`reco`, `custom`); each is distinguished
only by the `source` label it carries and the ingester's validation and storage
logic is identical for both. The `default` home is a **shared** third surface
that is never pushed — it is built in-process from server-managed templates.

| Source | Owner | Push or pull | Notes |
| --- | --- | --- | --- |
| `reco` | External reco engine | push (RECO POSTs results) | Already wired today via `PUT /internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey`. Runs daily on the reco service's schedule. |
| `custom` | External per-user service | push (same endpoint shape, different auth) | **Not** admin-curated. The external service authenticates with a per-user PAT carrying `recommendations:write`; API-key/PAT validation is **not** the ingester's job — it happens at the HTTP edge before the ingester is called. |
| `default` | Crispy Server (in-process, shared) | built on demand, cached in Redis | Owns `home.default_list_templates` and the Trakt/TMDB list-source plugins. Builds one hydrated English snapshot, reused by every profile; never materialized into per-profile rows. |

### Component boundaries

The pipeline is intentionally split so each concern can be tested and evolved
without leaking into the others:

```text
                 ┌─────────────────┐
                 │ external reco   │── push ──┐
                 │ external custom │── push ──┤
                 └─────────────────┘          │
                                              ▼
             ┌─────────────────────────────────────────────┐
             │  HTTP edge (auth, PAT validation, scopes)    │
             │  PUT /internal/apps/v1/.../lists/:listKey    │
             └─────────────────────────────────────────────┘
                                              │
                                              ▼
             ┌─────────────────────────────────────────────┐
             │  Home ingester (writeHome)                   │
             │  - validate whole-snapshot shape              │
             │  - canonicalize provider refs -> itemId       │
             │  - apply policy (items ≥1, ≤100, no dup keys)│
             │  - atomic replace + versioning + retention    │
             │  - idempotency-key replay/conflict detection  │
             └─────────────────────────────────────────────┘
                                              ▲
                                              │ shared read on miss
             ┌─────────────────────────────────────────────┐
             │  Default home builder (in-process, shared)   │
             │  - reads home.default_list_templates          │
             │  - resolves locale for the viewer pool        │
             │  - invokes list-source plugins (Trakt, TMDB) │
             │  - hydrates one English snapshot into Redis   │
             │    (versioned key, TTL-expired)               │
             └─────────────────────────────────────────────┘
                                              ▲
                                              │ on read-miss (cache cold)
```

### Atomic, whole-snapshot writes

The ingester never updates a single rail in isolation. A write call carries
**every** rail for one source, and the storage routine (`replaceHomeForSource`)
soft-deletes all existing active rows for `(profile, source)` in one UPDATE,
then inserts the new rails, all inside a single DB transaction. A failed
write leaves the previous snapshot intact — the read path keeps serving it.

Implications:

- A producer that wants to change one rail must resend **all** rails of the
  home. The ingester does not merge.
- A producer may not submit a rail with zero items. The ingester hard-rejects
  the whole snapshot with `400 INVALID_ITEMS` if any rail is empty.
- Producers are therefore obligated to guarantee "every rail I submit is
  non-empty" before calling the ingester.

### Single-source resolution

`GET /home` picks **one** source for the entire response based on the
profile's `homeMode` and which source has populated rows:

- `homeMode === 'custom'`: try `custom` rows; if none, return empty (custom
  mode does not layer `reco` or `default`). Switching from `custom` to `reco`
  requires a one-shot clear of custom rows for that profile so `reco` rows can
  win — this is performed in the reco pipeline, not the ingester.
- `homeMode === 'reco'` (default): try `reco` rows; if none, serve the shared
  default home. The default snapshot is built lazily on first miss and cached
  in English, so every profile without a stored home shares one build. Only if
  the shared build itself fails (e.g. Trakt catastrophic outage) or resolves to
  zero rails does the read return `source: 'empty'`. Kids profiles are excluded
  from the shared default in v1 and report `empty`.

**Never mixing sources** is a hard rule: a single home response is always 100%
from one source. The resolver does not concatenate rails across sources.

### Retention

The home store keeps a bounded number of snapshots per `(profile, source)`:

- `custom` — keep current + 1 previous snapshot
- `reco` — keep current + 1 previous snapshot

The shared default home has no per-profile snapshots to retain: there is
exactly one Redis-cached English snapshot, expired by TTL and rebuilt when
an admin template edit bumps the cache version.

A snapshot is identified by a `run_id` UUID shared by every rail written in a
single atomic write. The prune step runs inside the write transaction, after
the new rails are inserted, deleting `recommendation_list_versions` rows whose
`run_id` is outside the keep-set.

### What this pipeline replaces (vs. the prior design)

- The "fallback is a per-profile written snapshot" model. The old fallback
  service materialized a `source='fallback'` home per profile (signup seed job,
  admin sync fan-out, resolver self-heal). It is now a **shared** read artifact:
  one hydrated English snapshot in Redis, never written to per-profile rows.
  The signup seed job, the home queue, and the admin per-rail sync endpoint no
  longer exist.
- The "eager fallback-pull on push failure" listener. Push failure →
  previous snapshot stays intact (transaction rollback) → resolver reads the
  previous rows on next request. No eager-fetch listener is required.
- Read-time self-heal writes. The resolver's only read-time fallback is serving
  the shared default snapshot; it never writes per-profile rows during a read.
- Continue-watching remains a separate, real-time, per-profile rail layered on
  top of the materialized home at read time (already migrated out of the
  list-source registry).

## Explicit non-goals

This contract does not define:

- MAIN polling RECO for generation job status.
- Recommendation worker job ids exposed by MAIN.
- RECO's internal queue implementation.
- Ranking algorithms or model internals.
- Direct database, Supabase, Redis, or admin-UI scraping access by RECO.
- A compatibility layer for Crispy-itemId writes or TMDB-only write bodies. There is no dual-shape `BaseItemDto` fallback alongside the `ClientMediaCard` read shape; the card shape is the one shape going forward and consumer-side enrichment layers (`CatalogService`, `signal_bundle_mapper`, `WatchMetadataEnrichmentService`, `AdminWatchReadService`) are deleted, not retained.

## Future lifecycle gaps

Future contract work should explicitly cover durable generation job ids, status/progress endpoints, callbacks or durable completion events, cancellation/pause/resume semantics, safe debug/error schemas, and dedupe/coalescing behavior for profile-level recompute bursts.
