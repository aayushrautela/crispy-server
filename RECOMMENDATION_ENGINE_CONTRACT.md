# Recommendation Engine Integration Contract

## Status

Current architecture contract for recommendation-engine integration. The machine-readable source of truth for the provider-owned endpoint shapes, examples, and canonical error envelope is `openapi/internal-recommender.v1.yaml`; this document provides narrative integration context and must not override the OpenAPI contract.

The recommendation engine is an external event-driven service. Crispy Server emits durable recompute events through its outbox; the engine receives those events, retrieves profile, watch, rating, watchlist, episodic follow, metadata, and stored recommendation context needed for generation, then publishes results back to Crispy Server.

For AI-assisted generation, the engine sends business inputs and a bounded candidate pool to Crispy Server's internal AI-plan endpoint. Crispy Server owns provider selection, model selection, credentials, prompt construction, vendor protocol, response parsing, and typed-plan validation. The engine never receives OpenRouter, OpenAI-compatible, server-funded, or account BYOK API keys, provider/model routing config, proxy URLs, or raw vendor request details.

## Ownership Boundary

| Area | Owner |
|---|---|
| Account/profile ownership and authorization | Crispy API Server |
| Watch history, ratings, watchlist, continue watching, episodic follow | Crispy API Server |
| Canonical media identity and metadata projections | Crispy API Server |
| Stored recommendation snapshots served to clients | Crispy API Server |
| Recommendation model logic and generation strategy | External recommendation engine |
| Pulling eligible source data for generation after recompute events | External recommendation engine through Crispy API |
| Internal queue jobs in this repository | Internal BullMQ worker |

The external recommendation engine is not this repository's BullMQ worker and must not read Crispy Server storage directly.

## Authentication

### Inbound: Engine to Crispy Server

The engine authenticates to Crispy API as a service principal using the existing service-to-service headers:

```text
x-service-id: crispy-recommendation-engine
Authorization: Bearer <raw token whose SHA-256 hash matches RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH>
```

`RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH` controls access for the official recommender API token. Configure it to the SHA-256 hash of the raw bearer token used by the recommender deployment.

### Outbound: Crispy Server to Engine

Crispy Server's outbox dispatcher authenticates to the engine's event ingestion endpoint using:

```text
Authorization: Bearer <MAIN_TO_RECOMMENDER_SERVICE_TOKEN>
```

The engine validates this token by comparing its SHA-256 hash against its configured `MAIN_TO_RECOMMENDER_SERVICE_TOKEN_HASH`.

## Source Data Retrieval

The engine pulls data from documented internal API endpoints. It should prefer account-rooted routes and resolve account ownership before reading profile-scoped data.

Typical source-data categories:

- profile roster and profile metadata
- watch history and watch state
- ratings
- watchlist
- continue watching
- episodic follow state
- current stored taste profile and recommendation snapshots
- candidate-pool and business context for AI-plan requests
- metadata projections for canonical media keys

Crispy API must return bounded, sanitized, authorized data only. The engine must not scrape admin UI pages, bypass service auth, query Postgres directly, read Redis directly, or access undeclared private fields.

## AI-Plan Flow

When generation requires AI-assisted ranking or planning, the engine must use Crispy's internal AI-plan endpoint:

1. Prepare business inputs: profile signals, candidate pool, list key, algorithm version, and generation context.
2. Call `POST /internal/recommendations/v1/accounts/:accountId/profiles/:profileId/ai-plan` with service auth.
3. MAIN validates account/profile eligibility, builds the prompt, selects provider/model/credentials, calls the AI vendor, parses the response, and returns a typed plan.
4. The engine uses the plan output to assemble final recommendation lists.
5. The engine writes generated recommendation outputs back through the internal app recommendation endpoints.

The engine must not request, receive, cache, log, or forward raw account BYOK keys, server-funded keys, OpenRouter keys, OpenAI-compatible provider keys, proxy URLs, model names, provider IDs, endpoint URLs, or raw vendor chat-completions payloads. AI-plan requests contain only business inputs and candidate pools; AI-plan responses contain only typed plan outputs.

## Error Handling

All non-2xx responses use the canonical error envelope defined in the OpenAPI contract. Error responses include:

- `error.code`: Canonical error code (e.g., `AI_PLAN_PROVIDER_UNAVAILABLE`, `UNSUPPORTED_RECOMMENDATION_WRITE_FIELD`)
- `error.message`: Human-readable error message
- `error.category`: Error category for client-side handling
- `error.retryable`: Boolean indicating if the request can be retried
- `error.requestId`: Request identifier for tracing
- `error.details`: Optional structured details (never contains nested `code` field)

The engine must handle retryable errors with exponential backoff and respect rate limit headers.

## Result Publication

Generated outputs are published back through the internal app recommendation write endpoints. The engine writes ordered arrays of `{ type: "movie" | "tv", tmdbId: number }` references only. The server derives source, rank from array order, canonical media keys, write mode, eligibility version, and all other storage/policy metadata.

Writers must not send enriched fields such as `contentId`, `mediaKey`, `rank`, `score`, `reasonCodes`, `metadata`, `media` payloads, `purpose`, `writeMode`, `eligibilityVersion`, or `signalsVersion`. These are server-derived or rejected.

Result ingestion is idempotent by profile, list key, and idempotency key. Retries must be safe to repeat without duplicating active list versions.

## Identity Requirements

Recommendation write items use TMDB references:

```json
{ "type": "movie", "tmdbId": 550 }
```

Allowed `type` values are `movie` and `tv`. Crispy derives canonical media keys such as `movie:tmdb:550` and `tv:tmdb:1399` when storing service-owned recommendation lists. Array order is the recommendation rank.

Read/source signal payloads expose canonical `mediaKey` values for navigation and metadata joins.

## Source Signal Identity

Recommender source signals identify media by canonical `mediaKey`. The engine must use `mediaKey` for all identity operations and metadata joins.

## Pagination, Freshness, and Rate Limits

The engine must follow API pagination, cursor, and filtering rules for every source-data endpoint. It should request only the profiles and windows of data needed for generation.

Freshness decisions belong to the engine's scheduling strategy unless Crispy API exposes explicit freshness hints. The engine should respect API rate limits, retry transient failures with backoff, and avoid unbounded fan-out against profile data or metadata endpoints.

## Sensitive Data and Logging

The engine must not log API keys, user access tokens, account-shared AI secrets, provider refresh tokens, bearer tokens, service API keys, AI provider/model/endpoint/proxy configuration, raw vendor request/response payloads, or raw confidential configuration. Logs should use account/profile identifiers only when operationally necessary and should avoid storing raw watch or rating payloads longer than needed.

## Explicit Non-Goals

This contract does not define:

- API Server -> engine `POST /v1/generations` submission
- API Server polling `GET /v1/generations/:jobId`
- Recommendation Worker job IDs
- engine-internal queue implementation
- ranking algorithms or model internals
- direct database access by the engine

For current integration guidance, use this contract as the source of truth. Obsolete API Server -> worker push/poll contracts are intentionally not part of the active documentation set.
