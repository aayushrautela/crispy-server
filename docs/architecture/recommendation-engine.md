# Recommendation engine boundary

## Status

Target architecture and security contract for integration between Crispy Server (MAIN) and the external recommendation engine (RECO).

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
framework governs the three home ingest pipeline producers (`reco`,
`custom`, `fallback`), and is the sole source of principal shape.

| Producer | App identity | Auth mechanism | Scope of access |
| --- | --- | --- | --- |
| `reco` | `app_registry.app_id = 'reco'` | Bearer token verified against `RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH` env var (legacy single-token mechanism preserved for operational continuity; principal resolved from `app_registry` / `app_scopes` / `app_grants` / `app_source_ownership` rows on match) | system-wide: any profile's signals read, any profile's home lists write |
| `fallback` | `app_registry.app_id = 'fallback'` | Bearer AppKey verified by `DefaultAppAuthService.authenticateRequest` (an `app_keys` row for `fallback` is created by an operator at deployment time) | system-wide: any profile's signals read, any profile's fallback home lists write (`source='fallback'` constraint) |
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

### AppKey principal resolution (fallback)

Fallback authenticates with a `Bearer <AppKey>` (AppKey scheme is the multi-app
framework in `src/modules/apps/`): the dispatcher hashes the secret and matches
against an `app_keys` row for `app_id='fallback'`. Scopes, grants, and source
ownership are resolved from the same DB rows. An operator inserts the
`fallback` `app_keys` row when the fallback service goes live.

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

RECO retrieves bounded, authorized machine inputs through MAIN internal APIs. Per the per-signal refactor, MAIN no longer exposes a single bundle endpoint; RECO issues parallel `GET` requests against the per-signal read routes (history, ratings, watchlist, continue-watching, episodic-follow, taste) plus a `profile-meta` route that returns profile-scoped fields (profileName, isKids, language, region, watchDataOrigin) for `GenerateRequest.profileContext` assembly, plus the eligibility decision.

Each watch signal route returns the same `BaseItemDtoQueryResult` envelope used by the public `/v1/profiles/:profileId/watch/*` routes — a `PaginatedWatchCollection<BaseItemDto>`. RECO's `signal_bundle_mapper` extracts from each row the `Tmdb` providerId (from `ProviderIds`), the media `type` (mapping `Type === 'Series'` to `'tv'`, `'Movie'` to `'movie'`), and the `UserData` fields it needs (`LastPlayedDate`, `PlayedPercentage`, `Played`, `Rating`, `PlayCount`) to construct `RecoItemRef`-shaped inputs for its internal `GenerateRequest`. The locally-assembled bundle never travels on the wire.

Signal records that RECO constructs from these reads carry `RecoItemRef` values with:

- media `type` (`movie` or `tv`)
- provider refs such as TMDB, TVDB, IMDb, or Kitsu

Signal records do not carry Crispy `itemId` on RECO's write side, and RECO never persists raw `BaseItemDto`, client `UserData`, titles, original titles, years, release dates, posters, backdrops, logos, trailers, or enriched display card payloads back to MAIN.

AI-assisted generation is owned entirely by RECO. MAIN does not expose an AI-plan endpoint and never sees provider credentials, model selection, prompts, or raw vendor traffic for recommendations.

1. RECO prepares business inputs, a bounded TMDB-backed candidate pool, list key, algorithm version, and generation context using provider refs.
2. RECO selects the AI provider/model and uses its own server-funded API key (`RECO_AI_API_KEY`, `RECO_AI_ENDPOINT_URL`, `RECO_AI_MODEL`) to call the OpenAI-compatible vendor directly from the worker process.
3. RECO builds the prompt, calls the vendor, parses and validates the response against the candidate pool, and resolves titles.
4. On any AI error or when AI is disabled, RECO falls back to deterministic TMDB trending/popular/top-rated lists.
5. RECO uses the typed plan to assemble final recommendation lists and writes generated outputs back through internal app recommendation endpoints.

RECO must not request, receive, cache, log, or forward raw account BYOK keys. MAIN keeps its own server-funded key only for non-recommendation AI features (`ai search`, `ai insights`).

## Result publication

Generated outputs are published back through internal app recommendation write endpoints. RECO writes list metadata plus ordered provider identities.

See "Home ingest pipeline" below for the unified producer contract (reco, custom, fallback) and the transform/write path. The same endpoint and request shape are reused for every source; only the `source` field on the stored snapshot distinguishes provenance.

RECO must not send Crispy `itemId`, nested identity wrappers, enriched card payloads, `BaseItemDto`, posters, descriptions, storage `contentId`, media keys, write-mode fields, eligibility versions, or arbitrary unbounded metadata.

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

Three producers feed the home store. Each is distinguished only by the
`source` label it carries; the ingester's validation and storage logic is
identical for all three.

| Source | Owner | Push or pull | Notes |
| --- | --- | --- | --- |
| `reco` | External reco engine | push (RECO POSTs results) | Already wired today via `PUT /internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey`. Runs daily on the reco service's schedule. |
| `custom` | External per-user service | push (same endpoint shape, different auth) | **Not** admin-curated. The external service authenticates with a per-user PAT carrying `recommendations:write`; API-key/PAT validation is **not** the ingester's job — it happens at the HTTP edge before the ingester is called. |
| `fallback` | Crispy Server (in-process service) | produced on signup + on admin sync + on read-miss | Owns the templates table, the Trakt/TMDB list-source plugins, and locale/region resolution. Calls the ingester via the same `writeHome` service used by the push path. **Not** an HTTP endpoint — it is an in-process module owned by the home module. |

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
                                              │ in-process call
             ┌─────────────────────────────────────────────┐
             │  Fallback service (in-process)               │
             │  - reads home.fallback_list_templates         │
             │  - resolves locale + region for viewer       │
             │  - invokes list-source plugins (Trakt, TMDB) │
             │  - either returns a fully-populated snapshot  │
             │    OR returns empty (don't call ingester)    │
             └─────────────────────────────────────────────┘
                                              ▲
                                              │ on signup
                                              │ on admin sync
                                              │ on read-miss (resolver self-heal)
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
  non-empty" before calling the ingester. For `fallback`, this means the
  fallback service drops any rail whose source-fetch returned 0 items, and
  declines to call the ingester at all if zero rails remain (preserving the
  previously-written fallback home).

### Single-source resolution

`GET /home` picks **one** source for the entire response based on the
profile's `homeMode` and which source has populated rows:

- `homeMode === 'custom'`: try `custom` rows; if none, return empty (custom
  mode does not layer `reco` or `fallback`). Switching from `custom` to `reco`
  requires a one-shot clear of custom rows for that profile so `reco` rows can
  win — this is performed in the reco pipeline, not the ingester.
- `homeMode === 'reco'` (default): try `reco` rows; if none, fall back to
  `fallback` rows; if none, the resolver **self-heals**: it in-band calls the
  fallback service, ingests a fresh fallback snapshot, and returns it. Only
  if the fallback fetch itself fails (e.g. Trakt catastrophic outage) does
  the read return `source: 'empty'`.

**Never mixing sources** is a hard rule: a single home response is always 100%
from one source. The resolver does not concatenate rails across sources.

### Retention

The home store keeps a bounded number of snapshots per `(profile, source)`:

- `custom` — keep current + 1 previous snapshot
- `reco` — keep current + 1 previous snapshot
- `fallback` — keep current snapshot only (fallback is deterministic; older
  snapshots carry no product-meaningful state to roll back to)

A snapshot is identified by a `run_id` UUID shared by every rail written in a
single atomic write. The prune step runs inside the write transaction, after
the new rails are inserted, deleting `recommendation_list_versions` rows whose
`run_id` is outside the keep-set.

### What this pipeline replaces (vs. the prior design)

- The "fallback is an HTTP endpoint returning `RecoListWriteRequest`"
  framing. Fallback is an in-process service, not a service-to-service HTTP
  call. The same `writeHome` ingester is reused; no separate fallback HTTP
  endpoint exists or is planned.
- The "eager fallback-pull on push failure" listener. Push failure →
  previous snapshot stays intact (transaction rollback) → resolver reads the
  previous rows on next request. No eager-fetch listener is required.
- The read-time materialization branches. `/home` reads only from what the
  pipeline wrote; there is no "cached default home + freshly-built default
  home" branch. The resolver's only read-time behavior is self-heal when a
  profile has **zero rows across all sources**.
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
- A compatibility layer for old BaseItemDto recommendation sections, Crispy-itemId writes, or TMDB-only write bodies.

## Future lifecycle gaps

Future contract work should explicitly cover durable generation job ids, status/progress endpoints, callbacks or durable completion events, cancellation/pause/resume semantics, safe debug/error schemas, and dedupe/coalescing behavior for profile-level recompute bursts.
