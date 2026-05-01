# Recommendation Engine Integration Contract

## Status

Current architecture contract for recommendation-engine integration.

The recommendation engine is an external pull-based service. It calls authenticated Crispy API endpoints to retrieve profile, watch, rating, watchlist, episodic follow, metadata, AI configuration, and stored recommendation context needed for generation. Crispy Server does not submit generation jobs to the engine and does not poll the engine for job status.

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
- account/profile AI configuration when authorized
- metadata projections for canonical media keys

Crispy API must return bounded, sanitized, authorized data only. The engine must not scrape admin UI pages, bypass service auth, query Postgres directly, read Redis directly, or access undeclared private fields.

## Result Publication

Generated outputs are published back through the agreed internal API surface for service-owned recommendation outputs. Result delivery is not an API Server-submitted worker job lifecycle.

Result ingestion should be idempotent by profile, source/algorithm version, and snapshot identity. Retries must be safe to repeat without duplicating active snapshots. If a future callback or alternate result-delivery mechanism is introduced, document it as result ingestion/publication rather than API Server polling a worker job.

## Identity Requirements

Recommendation result items must use canonical TMDB-backed `mediaKey` values:

```text
movie:tmdb:{tmdbId}
show:tmdb:{tmdbId}
season:tmdb:{showTmdbId}:{seasonNumber}
episode:tmdb:{showTmdbId}:{seasonNumber}:{episodeNumber}
person:tmdb:{tmdbId}
```

TVDB and Kitsu identifiers are not canonical runtime identities. They may appear only as non-canonical import-source identifiers, external-id metadata, or compatibility crosswalk fields when Crispy API explicitly returns them.

Anime-origin titles are represented as ordinary TMDB `movie` or `show` content. There is no first-class backend `anime` media type in the current architecture.

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
