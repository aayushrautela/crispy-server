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

### RECO to MAIN

RECO authenticates to MAIN as a service principal using service-to-service headers:

```text
x-service-id: crispy-recommendation-engine
Authorization: Bearer <raw token whose SHA-256 hash matches RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH>
```

`RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH` is configured in MAIN and stores the SHA-256 hash of the raw bearer token used by RECO.

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

## Source data and AI-plan flow

RECO retrieves bounded, authorized machine inputs through MAIN internal APIs. The profile signal bundle endpoint is hydrated by MAIN from profile context plus canonical watch history, ratings, watchlist, continue-watching state, negative signals, and impressions.

Signal records carry `RecoItemRef` values with:

- media `type` (`movie` or `tv`)
- provider refs such as TMDB, TVDB, IMDb, or Kitsu

Signal records do not carry Crispy `itemId`, `BaseItemDto`, client `UserData`, titles, original titles, years, release dates, posters, backdrops, logos, trailers, or enriched display card payloads.

When AI assistance is needed:

1. RECO prepares business inputs, candidate pool, list key, algorithm version, and generation context using provider refs.
2. RECO calls MAIN's internal AI-plan endpoint with service auth.
3. MAIN validates account/profile eligibility, builds prompts, selects provider/model/credentials, calls the AI vendor, parses the response, and returns a typed provider-ref plan.
4. RECO uses the typed plan to assemble final recommendation lists.
5. RECO writes generated outputs back through internal app recommendation endpoints.

RECO must not request, receive, cache, log, or forward raw account BYOK keys, server-funded keys, provider keys, proxy URLs, AI provider IDs, AI model names, endpoint URLs, raw prompts, raw vendor request payloads, or raw vendor responses.

## Result publication

Generated outputs are published back through internal app recommendation write endpoints. RECO writes list metadata plus ordered provider identities.

Target body shape:

```json
{
  "title": "Because you watched The Matrix",
  "subtitle": "Mind-bending sci-fi picks",
  "sectionType": "contentRail",
  "items": [
    {
      "type": "movie",
      "providerRefs": [{ "provider": "tmdb", "providerId": "603" }],
      "score": 0.98,
      "reason": "Similar tone and themes",
      "reasonCodes": ["similar_history"],
      "metadata": {}
    },
    {
      "type": "tv",
      "providerRefs": [{ "provider": "tvdb", "providerId": "79168" }],
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

MAIN derives rank from array order, resolves every provider identity to canonical item IDs, applies eligibility and policy checks, persists list metadata, and enriches public client cards at read time.

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

## Explicit non-goals

This contract does not define:

- API Server to engine push-submission endpoints outside service-outbox event delivery.
- MAIN polling RECO for generation job status.
- Recommendation worker job ids exposed by MAIN.
- RECO's internal queue implementation.
- Ranking algorithms or model internals.
- Direct database, Supabase, Redis, or admin-UI scraping access by RECO.
- A compatibility layer for old BaseItemDto recommendation sections, Crispy-itemId writes, or TMDB-only write bodies.

## Future lifecycle gaps

Future contract work should explicitly cover durable generation job ids, status/progress endpoints, callbacks or durable completion events, cancellation/pause/resume semantics, safe debug/error schemas, and dedupe/coalescing behavior for profile-level recompute bursts.
