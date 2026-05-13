# Recommendation API guide

This guide explains recommendation behavior for integrators and operators. Exact paths, parameters, request bodies, response schemas, status codes, examples, and error envelopes are owned by OpenAPI:

- Public profile recommendation reads/writes: `openapi/public-app.v1.yaml`
- Internal app data and recommendation writes: `openapi/internal-services.v1.yaml`
- MAIN-to-RECO event ingestion: `openapi/internal-recommender.v1.yaml`
- Admin recompute and diagnostics: `openapi/admin-ops.v1.yaml`

## Public profile recommendation endpoints

Public recommendation endpoints operate on a profile that belongs to the authenticated account. Requests use the same user bearer/session auth or PAT behavior documented in the OpenAPI contract.

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/profiles/:profileId/taste-profiles` | List stored taste profiles across sources. |
| `GET /v1/profiles/:profileId/taste-profile` | Read one taste profile, defaulting to the configured recommendation source when `sourceKey` is omitted or invalid. |
| `PUT /v1/profiles/:profileId/taste-profile` | Create or replace a taste profile for the resolved source. |
| `GET /v1/profiles/:profileId/recommendations` | Read one stored recommendation snapshot, defaulting source and algorithm version from server configuration when omitted or invalid. |
| `PUT /v1/profiles/:profileId/recommendations` | Create or replace a stored recommendation snapshot. |

Common behavior:

- `profileId` selects a persona under the authenticated account; profiles are not separate auth actors.
- Missing or inaccessible profiles are authorization/not-found failures.
- A profile may have no recommendation signals yet; empty signal arrays are valid input for generation.
- `GET /recommendations` returns a successful response with a null recommendation snapshot when no snapshot exists for the resolved profile/source/algorithm version. This differs from an existing snapshot whose item arrays are empty.
- Recommendation read items use canonical server-enriched `mediaItem` presentation data, including `images.poster`, `images.backdrop`, `images.logo`, and `images.still` responsive sets with `small`, `medium`, and `large` nullable URLs, plus `rating`, `releaseYear`, and `maturityRating`.
- Scalar legacy image fields such as `posterUrl`, `backdropUrl`, `logoUrl`, and `stillUrl` are not returned. `images.logo` is best-effort TMDB artwork and may contain null sizes even when posters/backdrops exist.
- Legacy public account recommendation endpoints (`GET /api/account/v1/profiles/:profileId/recommendations/current` and `PUT/DELETE /api/account/v1/profiles/:profileId/recommendations/:listKey`) have been retired; clients should use `GET /v1/profiles/:profileId/recommendations` and `PUT /v1/profiles/:profileId/recommendations`.

## Recommendation writes

Recommendation write requests use ordered TMDB references. Writers submit the minimal item identity needed for MAIN to derive stored data, ranking, and canonical media keys.

```json
{ "type": "movie", "tmdbId": 550 }
```

Rules:

- Allowed item media types are the values defined in OpenAPI for the endpoint.
- Array order is the recommendation rank.
- MAIN derives source, rank, canonical `mediaKey`, write mode, storage metadata, and eligibility policy.
- Active writers must not send enriched card payloads, `contentId`, `mediaKey`, provider fragments, rank fields, score fields, write-mode fields, eligibility versions, or arbitrary stored metadata unless the OpenAPI contract explicitly adds those fields.

## Generation model

Recommendation generation is event-driven:

1. MAIN emits durable `recommendation.recompute_requested` events through `service_outbox_events`.
2. The MAIN outbox dispatcher posts those envelopes to RECO's inbound `POST /internal/recommender/v1/events` endpoint with service auth.
3. RECO authenticates to MAIN as an internal app principal and reads bounded business inputs from `/internal/apps/v1` endpoints.
4. When AI assistance is needed, RECO calls MAIN's internal AI-plan endpoint with business inputs and a bounded candidate pool.
5. MAIN owns AI provider selection, model selection, credentials, prompt construction, vendor protocol, response parsing, and typed-plan validation.
6. RECO publishes final stored outputs back through internal app recommendation write endpoints.

RECO must not receive, cache, log, or forward raw account BYOK keys, server-funded AI keys, provider/model routing config, proxy URLs, raw prompts, or raw vendor chat-completions payloads.

## Admin recompute MVP

Admin operators can request asynchronous recommendation recomputation through admin-only endpoints documented in `openapi/admin-ops.v1.yaml`.

| Endpoint | Behavior |
| --- | --- |
| `POST /admin/api/accounts/:accountId/profiles/:profileId/recommendations/recompute` | Enqueues one recompute event for a profile and returns `202 Accepted`. |
| `POST /admin/api/accounts/:accountId/recommendations/recompute` | Enqueues recompute events for selected profiles under an account and returns `202 Accepted`; the MVP accepts selected `profileIds` and caps one request at 50 profiles. |
| `GET /admin/api/diagnostics/recommendations/service-outbox` | Lists recommendation service-outbox dispatch records with filters such as `correlationId`, `profileId`, `reason`, `status`, and `limit`. |

Admin-triggered recompute events use reason `admin_requested`.

Diagnostics are dispatch diagnostics only. Status values such as `pending`, `processing`, `dispatched`, and `failed` describe MAIN service-outbox delivery state. A `dispatched` event means MAIN delivered the event envelope to RECO ingestion; it does not prove generation completed or that a new recommendation snapshot is available.

## MAIN-to-RECO event ingestion

RECO owns `POST /internal/recommender/v1/events`; MAIN calls it from the service-outbox dispatcher.

Current event type:

```text
recommendation.recompute_requested
```

Current runtime reasons include watch/rating/watchlist/progress/profile changes and `admin_requested` for admin-triggered recompute.

Dispatcher handling:

- `2xx`: success; MAIN may mark the outbox row dispatched.
- `409 Conflict`: duplicate receipt; treated as idempotent success by MAIN.
- `400 Bad Request`: permanent schema/validation failure until the event or contract is fixed.
- `401 Unauthorized` or `403 Forbidden`: auth/configuration failure until credentials or authorization are fixed.
- `5xx`, network errors, and timeouts: transient; retry according to the service-outbox retry policy.

The MVP ingestion response acknowledges acceptance and may include a RECO event identifier. It does not return a durable generation job id, generation status, or progress to MAIN.

## Future lifecycle gaps

The MVP intentionally does not define a full generation lifecycle API. Future contract work should cover durable generation job ids, status/progress endpoints, completion callbacks or events, cancellation/pause/resume semantics, safe debug/error schemas, and dedupe/coalescing behavior for recompute bursts.
