# Recommendation Engine Integration Contract

## Status

Current architecture contract for recommendation-engine integration.

The recommendation engine is an external pull-based service. It calls authenticated Crispy API endpoints to retrieve profile, watch, rating, watchlist, episodic follow, metadata, AI configuration, and stored recommendation context needed for generation. Crispy Server does not submit generation jobs to the engine and does not poll the engine for job status.

For AI-assisted generation, the engine retrieves a confidential config bundle, receives a scoped Crispy AI proxy endpoint, calls that proxy, and publishes recommendations back to Crispy. The engine never receives OpenRouter, OpenAI-compatible, server-funded, or account BYOK API keys; Crispy injects the selected credential server-side when proxying the AI request.

## Ownership Boundary

| Area | Owner |
|---|---|
| Account/profile ownership and authorization | Crispy API Server |
| Watch history, ratings, watchlist, continue watching, episodic follow | Crispy API Server |
| Canonical media identity and metadata projections | Crispy API Server |
| Stored recommendation snapshots served to clients | Crispy API Server |
| Recommendation model logic and generation strategy | External recommendation engine |
| Pulling eligible source data for generation | External recommendation engine through Crispy API |
| Internal queue jobs in this repository | Internal BullMQ worker |

The external recommendation engine is not this repository's BullMQ worker and must not read Crispy Server storage directly.

## Authentication

The engine authenticates to Crispy API as a service principal using the existing service-to-service headers:

```text
x-service-id: crispy-recommendation-engine
Authorization: Bearer <raw token whose SHA-256 hash matches CRISPY_RECOMMENDER_API_TOKEN_HASH>
```

`CRISPY_RECOMMENDER_API_TOKEN_HASH` controls access for the official recommender API token. Configure it to the SHA-256 hash of the raw bearer token used by the recommender deployment.

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
- account/profile AI proxy configuration when authorized
- metadata projections for canonical media keys

Crispy API must return bounded, sanitized, authorized data only. The engine must not scrape admin UI pages, bypass service auth, query Postgres directly, read Redis directly, or access undeclared private fields.

## AI Proxy Flow

When generation requires an OpenAI-compatible model, the engine must use Crispy's confidential proxy flow:

1. Fetch `POST /internal/confidential/v1/accounts/:accountId/profiles/:profileId/config-bundle` with service auth.
2. Read the returned AI policy and scoped proxy endpoint.
3. Call `POST /internal/confidential/v1/accounts/:accountId/profiles/:profileId/ai-proxy/chat/completions` with the chat-completions payload.
4. Crispy validates account/profile eligibility, selects the allowed provider/credential, injects the API key server-side, and forwards the request to the configured provider.
5. The engine writes generated recommendation outputs back through the internal app recommendation endpoints.

The engine must not request, receive, cache, log, or forward raw account BYOK keys, server-funded keys, OpenRouter keys, or OpenAI-compatible provider keys. Confidential bundle fields are policy and routing metadata only.

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

Read/source signal payloads continue to expose canonical `mediaKey` values for navigation and metadata joins.

## Source Signal Identity

Recommender source signals identify media by canonical `mediaKey`. `contentId` is accepted only as a legacy alias during migration and must be normalized to `mediaKey` before generation logic treats the signal as canonical.

When source signals include media metadata, the recommender hydrates and joins metadata by `mediaKey`. It must not require duplicated `provider` or `providerId` fields as identity fragments.

## Pagination, Freshness, and Rate Limits

The engine must follow API pagination, cursor, and filtering rules for every source-data endpoint. It should request only the profiles and windows of data needed for generation.

Freshness decisions belong to the engine's scheduling strategy unless Crispy API exposes explicit freshness hints. The engine should respect API rate limits, retry transient failures with backoff, and avoid unbounded fan-out against profile data or metadata endpoints.

## Sensitive Data and Logging

The engine must not log API keys, user access tokens, account-shared AI secrets, provider refresh tokens, bearer tokens, service API keys, or raw confidential configuration. Logs should use account/profile identifiers only when operationally necessary and should avoid storing raw watch or rating payloads longer than needed.

## Explicit Non-Goals

This contract does not define:

- API Server -> engine `POST /v1/generations` submission
- API Server polling `GET /v1/generations/:jobId`
- Recommendation Worker job IDs
- engine-internal queue implementation
- ranking algorithms or model internals
- direct database access by the engine

For current integration guidance, use this contract as the source of truth. Obsolete API Server -> worker push/poll contracts are intentionally not part of the active documentation set.
