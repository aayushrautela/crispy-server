# Recommendation engine boundary

## Status

Current architecture and security contract for integration between Crispy Server (MAIN) and the external recommendation engine (RECO).

OpenAPI remains the machine-readable source of truth for exact endpoint shapes, status codes, examples, and error envelopes:

- `openapi/internal-services.v1.yaml` for RECO calls into MAIN internal app and AI-plan APIs.
- `openapi/internal-recommender.v1.yaml` for MAIN service-outbox calls into RECO event ingestion.
- `openapi/admin-ops.v1.yaml` for admin recompute and diagnostics.
- `docs/api/recommendations.md` for human-facing recommendation API and operator guidance.

## Ownership boundary

| Area | Owner |
| --- | --- |
| Account/profile ownership and authorization | Crispy API Server + Supabase RLS behind Fastify |
| Watch history, ratings, watchlist, continue watching, episodic follow | Supabase user-interaction state behind Crispy API Server |
| Canonical media identity and metadata projections | Crispy API Server |
| Stored recommendation snapshots served to clients | Crispy API Server |
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

## Admin recompute MVP

Admin recompute endpoints enqueue service-outbox events and return asynchronous acceptance. The exact endpoint contracts live in `openapi/admin-ops.v1.yaml` and are summarized in `docs/api/recommendations.md`.

Diagnostics expose MAIN service-outbox delivery state only (`pending`, `processing`, `dispatched`, `failed`). A dispatched event means MAIN delivered the envelope to RECO ingestion; it does not prove recommendation generation completed or that new stored snapshots are available.

## Source data and AI-plan flow

RECO retrieves bounded, authorized business inputs through MAIN internal APIs. The profile signal bundle endpoint is hydrated by MAIN from authorized profile context plus canonical watch history, ratings, watchlist, and continue-watching state. Signal records carry `Item: BaseItemDto` plus signal-specific fields, so canonical item identity is `Item.Id` and provider references such as TMDB are available at `Item.ProviderIds.Tmdb`. MAIN may also include episodic follow state and other derived context. Storage details remain hidden behind the Fastify internal API contract.

When AI assistance is needed:

1. RECO prepares business inputs, candidate pool, list key, algorithm version, and generation context.
2. RECO calls MAIN's internal AI-plan endpoint with service auth.
3. MAIN validates account/profile eligibility, builds prompts, selects provider/model/credentials, calls the AI vendor, parses the response, and returns a typed plan.
4. RECO uses the typed plan to assemble final recommendation lists.
5. RECO writes generated outputs back through internal app recommendation endpoints.

RECO must not request, receive, cache, log, or forward raw account BYOK keys, server-funded keys, provider keys, proxy URLs, provider IDs, model names, endpoint URLs, raw prompts, raw vendor request payloads, or raw vendor responses.

## Result publication

Generated outputs are published back through internal app recommendation write endpoints. RECO writes ordered arrays of minimal TMDB references only, for example:

```json
{ "type": "movie", "tmdbId": 550 }
```

MAIN derives source, rank from array order, canonical item IDs, write mode, eligibility version, and storage/policy metadata. Writers must not send enriched card payloads, `contentId`, `itemId`, rank, score, provider fragments beyond the documented write reference, eligibility version, signals version, or arbitrary metadata unless the OpenAPI contract explicitly allows it.

Result ingestion is idempotent by profile, list key, and idempotency key where documented.

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

## Future lifecycle gaps

Future contract work should explicitly cover durable generation job ids, status/progress endpoints, callbacks or durable completion events, cancellation/pause/resume semantics, safe debug/error schemas, and dedupe/coalescing behavior for profile-level recompute bursts.
