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

RECO retrieves bounded, authorized machine inputs through MAIN internal APIs. The profile signal bundle endpoint is hydrated by MAIN from profile context plus canonical watch history, ratings, watchlist, continue-watching state, negative signals, and impressions.

Signal records carry `RecoItemRef` values with:

- media `type` (`movie` or `tv`)
- provider refs such as TMDB, TVDB, IMDb, or Kitsu

Signal records do not carry Crispy `itemId`, `BaseItemDto`, client `UserData`, titles, original titles, years, release dates, posters, backdrops, logos, trailers, or enriched display card payloads.

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

## Home ingest pipeline (target)

The home screen is recommendations. Client apps call `/home` and read back
whatever the pipeline wrote; the read path does not call external services
on-the-fly. Three sources feed one pipeline:

| Source | Type | Q | Push or pull | Notes |
| --- | --- | --- | --- | --- |
| `reco` | personalized recommendations | external reco engine | postalpush (RECO POSTs results) | already wired today via `PUT /internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey` |
| `custom` | curated lists from an external service | external | push (same endpoint, same fixed shape) | NOT admin-curated. Treated identically to `reco` from the pipeline's POV. |
| `fallback` | deterministic default templates (the table we already built) | internal | **pull on miss/failure** | Exposed as an internal HTTP service returning the *same* shape as the external sources. |

All three sources return the same fixed input contract (`RecoListWriteRequest`)
with `source` distinguishing the producer. The pipeline does not branch by
source at the transform/write boundary — it canonicalizes provider refs to
`itemId`, applies policy, and persists to the same per-profile storage target
that `/home` reads from.

### Pipeline stages

```text
[ external reco service ]--push-->|
[ external custom service ]--push-->|
                                   |
                                   v
                       +---------------------------+
                       |  Pipeline ingest endpoint |  (existing PUT /internal/apps/v1/.../lists/:listKey)
                       +---------------------------+
                                   |
                                   v
                       +---------------------------+
                       |  Transform                |  provider refs -> canonical itemId,
                       |  (canonicalize + policy)  |  section/item validation, eligibility
                       +---------------------------+
                                   |
                                   v
                       +---------------------------+
                       |  Write to home store      |  per-profile materialized home rails
                       |  (read by GET /home)      |  that GET /home serves from
                       +---------------------------+
                                   ^
                                   |  (on miss / push failure)
                       +---------------------------+
                       |  Fallback source (HTTP)    |  returns same RecoListWriteRequest shape
                       +---------------------------+
```

### Fallback source

Fallback is invoked in two eager scenarios and feeds through the *same*
pipeline path — it is not layered at read time:

1. **Empty home on `/home` read.** A client calls `GET /home` for a profile
   that has nothing materialized (new user, no reco/custom ever written, all
   rows expired). The pipeline calls the fallback HTTP endpoint for that
   profile, gets a `RecoListWriteRequest`-shaped payload, writes it, then the
   resolver returns the now-populated home. Surfaced as `source: 'fallback'`
   on the response.
2. **External push attempt failed.** An external `reco`/`custom` push returns
   a transform/validation/canonicalization error, or the external service is
   unreachable and the outbox dispatcher marks the event permanently failed.
   The pipeline eagerly calls the fallback endpoint for that profile and
   writes a fallback home so the user is never left empty.

The fallback HTTP endpoint is exposed internally and authenticated as a
service principal (same `x-service-id` + bearer hash scheme as the RECO→MAIN
contract). It is registered in `home.fallback_list_templates` (the table we
built), and `locale_mode='auto'` rows are resolved per-viewer at fallback-pull
time.

### What the pipeline replaces

- The lazy fallback-on-cache-miss path in `home-resolver.service.ts`. Fallback
  becomes an HTTP fetch + pipeline write, not an inline rail-build step.
- The read-time materialization branches. `/home` reads only from what the
  pipeline wrote; there is no "cached default home + freshly-built default
  home" branch.
- Continue-watching remains a separate, real-time, per-profile rail layered on
  top of the materialized home at read time (already migrated out of the
  list-source registry).

### Open implementation work

- Define and expose the fallback HTTP endpoint returning `RecoListWriteRequest`
  for a given `(accountId, profileId, locale, region, isKids)`.
- Implement the two eager fallback-pull triggers (push-failed listener, and
  `/home` read with empty store).
- Decide whether `custom` lists reuse the existing reco push endpoint or get a
  sibling route (preferred: same endpoint, distinguished by `source` /
  service-id).
- Define the producer service-id for `custom` and update the auth allow-list.

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
