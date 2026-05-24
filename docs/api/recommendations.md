# Recommendation API guide

This guide explains recommendation behavior for integrators and operators. Exact paths, parameters, request bodies, response schemas, status codes, examples, and error envelopes are owned by OpenAPI:

- Public profile recommendation reads/writes: `openapi/public-app.v1.yaml`
- Internal app data and recommendation writes: `openapi/internal-services.v1.yaml`
- MAIN-to-RECO event ingestion: `openapi/internal-recommender.v1.yaml`
- Admin recompute and diagnostics: `openapi/admin-ops.v1.yaml`

Target DTOs are defined in `docs/specs/client-reco-pipeline-spec.md`.

## Public profile recommendation endpoints

Public recommendation endpoints operate on a profile that belongs to the authenticated account. Requests use the same user bearer/session auth or PAT behavior documented in the OpenAPI contract.

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/profiles/:profileId/taste-profiles` | List stored taste profiles across sources. |
| `GET /v1/profiles/:profileId/taste-profile` | Read one taste profile, defaulting to the configured recommendation source when `sourceKey` is omitted or invalid. |
| `PUT /v1/profiles/:profileId/taste-profile` | Create or replace a taste profile for the resolved source. |
| `GET /v1/profiles/:profileId/home` | Read one stored home recommendation snapshot, defaulting source and algorithm version from server configuration when omitted or invalid. |
| `PUT /v1/profiles/:profileId/home` | Create or replace a stored home recommendation snapshot. |

Target public home behavior:

- `GET /home` returns `{ data: { recommendations }, meta: { requestId } }`.
- `recommendations` is either a stored home response or `null`.
- A home response contains `profileId`, `generatedAt`, `expiresAt`, and `sections`.
- Each section contains `listKey`, `title`, `subtitle`, `layout`, `items`, and `meta`.
- Section `title` is required.
- Section `subtitle` is nullable and present as `null` when absent.
- Items are UI-ready client cards with `itemId`, `mediaType`, title, artwork, lightweight metadata, and progress.
- Public recommendation cards do not expose provider refs, model scores, reason codes, storage `contentId`, media keys, or RECO internals.
- `BaseItemDto` is not the target shape for public recommendation home sections.

## Recommendation writes

RECO writes list metadata plus ordered item identities. MAIN derives rank from array order, canonicalizes item identity, applies policy/idempotency, persists list metadata, and enriches public client responses at read time.

Preferred single-list write target:

```json
{
  "title": "Because you watched The Matrix",
  "subtitle": "Mind-bending sci-fi picks",
  "layout": "regular",
  "items": [
    {
      "item": { "itemId": "8a1f7c852e864e2a9c0b77d9efc5a901" },
      "score": 0.98,
      "reason": "Similar tone and themes",
      "reasonCodes": ["similar_history"],
      "metadata": {}
    },
    {
      "item": {
        "ref": {
          "provider": "tvdb",
          "type": "tv",
          "providerId": "79168"
        }
      },
      "score": null,
      "reason": null,
      "reasonCodes": [],
      "metadata": {}
    }
  ],
  "model": {
    "runId": "rec-run-123",
    "algorithmVersion": "home-v3",
    "modelVersion": "ranker-2026-05"
  },
  "context": {}
}
```

Rules:

- `title`, `subtitle`, `layout`, and `items` belong to the list/section layer.
- Item identity is either public `itemId` or a generic provider ref.
- Provider refs may be TMDB, TVDB, IMDb, Kitsu, or another provider explicitly supported by MAIN.
- Rank is array order.
- RECO may send bounded scoring/explanation metadata for diagnostics and explainability.
- RECO must not send enriched card payloads, posters, backdrops, logos, descriptions, storage `contentId`, media keys, or client DTOs.
- MAIN resolves all item identities to canonical item IDs before storage.

## Generation model

Recommendation generation is event-driven:

1. MAIN emits durable `recommendation.recompute_requested` events through `service_outbox_events`.
2. The MAIN outbox dispatcher posts those envelopes to RECO's inbound `POST /internal/recommender/v1/events` endpoint with service auth.
3. RECO authenticates to MAIN as an internal app principal and reads bounded machine inputs from `/internal/apps/v1` endpoints.
4. Signal bundles contain interaction records and `RecoItemRef` values: public `itemId`, provider refs, and lightweight features.
5. Signal bundles do not contain `BaseItemDto`, posters, artwork, trailers, or client `UserData`.
6. When AI assistance is needed, RECO calls MAIN's internal AI-plan endpoint with business inputs and a bounded candidate pool.
7. MAIN owns AI provider selection, model selection, credentials, prompt construction, vendor protocol, response parsing, and typed-plan validation.
8. RECO publishes final lists back through internal app recommendation write endpoints.

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
