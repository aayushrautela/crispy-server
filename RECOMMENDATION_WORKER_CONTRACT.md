# Service Contract: API Server <-> Recommendation Worker

**Status:** Draft - async v1 proposal, hardened for API Server implementation
**Author:** Engineering
**Last Updated:** 2026-04-04
**Goal:** Define the smallest useful async contract so the Recommendation Worker team can start implementation without waiting on the API Server's internal async migration, while also closing the core semantics the API Server now depends on for durable submission and polling.

---

## 1. Purpose

This document defines the external contract between the **API Server** and the **Recommendation Worker**.

The contract changes the integration from a **blocking generation call** to an **async submit + status** model:

- The API Server submits a generation request quickly.
- The Recommendation Worker owns internal queueing, concurrency, retries, fairness, and execution.
- The API Server polls job status and persists the final outputs in its own storage.

The design goal for v1 is to preserve the **current request payload shape** and **current result payload shape** as much as possible, while changing only the transport contract.

### Explicit non-goals for v1

- No pricing or billing behavior is part of this contract.
- `pricingTier` is intentionally **not** sent to the Recommendation Worker.
- Webhooks/callbacks are not required for v1.
- Job cancellation is not required for v1.
- The Worker team's internal queue, concurrency model, or retry implementation is not prescribed here.

---

## 2. Ownership Boundaries

| Area | Owner |
|---|---|
| Detecting that a profile needs regeneration | API Server |
| Debouncing / coalescing noisy user triggers | API Server |
| Reading user data, watch history, ratings, watchlist, continue watching, tracked series | API Server |
| Resolving AI provider, model, API key, and credential source | API Server |
| Building the generation payload | API Server |
| Submitting generation work | API Server |
| Polling status and handling submission failures | API Server |
| Persisting taste profiles and recommendation snapshots | API Server |
| Serving stored recommendation outputs to clients | API Server |
| Assigning job IDs and managing job lifecycle | Recommendation Worker |
| Internal queueing, scheduling, concurrency, retries, backoff, fairness | Recommendation Worker |
| AI execution and recommendation generation | Recommendation Worker |
| Returning status, failures, and final results | Recommendation Worker |
| Health/readiness endpoints | Recommendation Worker |

### Boundary rules

- The Worker must not read user/account/profile/watch data directly from API Server storage.
- The Worker must not write API Server storage directly.
- The Worker may perform read-only catalog/discovery fetches against metadata providers if needed for enrichment.
- The API Server still owns the product behavior around "when do we regenerate" and "what is the active stored snapshot".

---

## 3. Contract Summary

### Business endpoints

```text
POST /v1/generations
GET  /v1/generations/:jobId
```

### Compatibility goal

For v1:

- The `POST /v1/generations` request body should reuse the current `RecommendationWorkerGenerateRequest` shape.
- The final successful job result should reuse the current `RecommendationWorkerGenerateResponse` shape, nested under `result` in the status response.

This keeps implementation scope focused on async transport rather than a second payload redesign.

### Optional operational endpoints

The Worker may also expose endpoints such as:

```text
GET /health
GET /ready
```

These are operational endpoints only and are not part of the business contract below.

---

## 4. Authentication and Required Headers

### All requests

| Header | Required | Notes |
|---|---|---|
| `x-service-id` | Yes | Internal service auth |
| `x-api-key` | Yes | Internal service auth |
| `x-request-id` | Yes | Request correlation and tracing |

### Submission requests only

| Header | Required | Notes |
|---|---|---|
| `idempotency-key` | Yes | Stable key for deduping retries and repeated submissions of the same logical generation |

### Content headers

| Header | Required | Notes |
|---|---|---|
| `content-type: application/json` | Yes for `POST` | Request body is JSON |
| `accept: application/json` | Recommended | Response body is JSON |

---

## 5. Job Identity and Idempotency

The Worker owns `jobId` generation. `jobId` is opaque to the API Server.

### Logical generation identity

For v1, the API Server should treat this tuple as the logical identity of a generation request:

```text
(profileId, sourceKey, algorithmVersion, historyGeneration)
```

### Idempotency requirements

- The API Server must send an `idempotency-key` header on every submission.
- The key must remain stable across retries of the same logical generation.
- Recommended key shape:

```text
recommendation:{profileId}:{sourceKey}:{algorithmVersion}:{historyGeneration}
```

- If the Worker receives the same `idempotency-key` with the same effective request body, it must treat it as the same logical job and return the same `jobId`.
- If the Worker receives the same `idempotency-key` but a materially different request body, it must reject the request with `409 IDEMPOTENCY_CONFLICT`.

### Retention

- The Worker must retain terminal job status and final result for at least **24 hours** after completion.
- This retention window allows safe polling and replay of idempotent submissions.
- After the retention window expires, the Worker may evict the job and return `404` from `GET /v1/generations/:jobId`.

### Cancellation

- `cancelled` is a valid status value.
- A cancellation endpoint is **not required** in v1.

---

## 6. Submit Endpoint

### Endpoint

```text
POST /v1/generations
```

### Semantics

- This endpoint must return quickly.
- It accepts or reuses a job; it does not block until generation completes.
- The Worker team's internal queueing, concurrency, and retry behavior remain implementation details.
- The API Server may safely retry the same submission after transport failures or timeouts by reusing the same `idempotency-key`.
- If the Worker has already finished the logical job by the time the submit request is processed, it may return a terminal `status` from the submit response.

The API Server therefore treats the submit response as an acceptance or reuse acknowledgement, not as the only source of truth for terminal outcomes.

### Request body

The request body reuses the current server-built `RecommendationWorkerGenerateRequest` shape.

```json
{
  "identity": {
    "accountId": "acc_123",
    "profileId": "prof_456"
  },
  "generationMeta": {
    "sourceKey": "default",
    "algorithmVersion": "v3",
    "historyGeneration": 42,
    "sourceCursor": "2026-04-04T10:15:00.000Z",
    "ttlSeconds": 86400
  },
  "watchHistory": [
    {
      "media": {
        "mediaType": "movie",
        "mediaKey": "movie:tmdb:550",
        "provider": "tmdb",
        "providerId": "550",
        "title": "Fight Club",
        "posterUrl": "https://...",
        "releaseYear": 1999,
        "rating": 8.8,
        "genre": null,
        "subtitle": null
      },
      "watchedAt": "2026-03-30T14:00:00.000Z",
      "payload": {}
    }
  ],
  "ratings": [
    {
      "media": {
        "mediaType": "movie",
        "mediaKey": "movie:tmdb:550",
        "provider": "tmdb",
        "providerId": "550",
        "title": "Fight Club",
        "posterUrl": "https://...",
        "releaseYear": 1999,
        "rating": 8.8,
        "genre": null,
        "subtitle": null
      },
      "rating": {
        "value": 9,
        "ratedAt": "2026-03-30T14:05:00.000Z"
      },
      "payload": {}
    }
  ],
  "watchlist": [
    {
      "media": {
        "mediaType": "show",
        "mediaKey": "show:tvdb:81189",
        "provider": "tvdb",
        "providerId": "81189",
        "title": "Breaking Bad",
        "posterUrl": "https://...",
        "releaseYear": 2008,
        "rating": 9.5,
        "genre": null,
        "subtitle": null
      },
      "addedAt": "2026-03-31T10:00:00.000Z",
      "payload": {}
    }
  ],
  "profileContext": {
    "profileName": "Main",
    "isKids": false,
    "watchDataOrigin": "native"
  },
  "aiConfig": {
    "providerId": "openai",
    "endpointUrl": "https://api.openai.com/v1/chat/completions",
    "httpReferer": "https://app.example.com",
    "title": "Crispy Recommendations",
    "model": "gpt-4o",
    "apiKey": "sk-...",
    "credentialSource": "user"
  },
  "optionalExtras": {
    "continueWatching": [
      {
        "id": "cw_1",
        "media": {
          "mediaType": "episode",
          "mediaKey": "episode:tvdb:3492321",
          "provider": "tvdb",
          "providerId": "3492321",
          "title": "Ozymandias",
          "posterUrl": "https://...",
          "backdropUrl": "https://...",
          "releaseYear": 2013,
          "rating": 10,
          "genre": null,
          "seasonNumber": 5,
          "episodeNumber": 14,
          "episodeTitle": "Ozymandias",
          "airDate": "2013-09-15",
          "runtimeMinutes": 47
        },
        "progress": {
          "positionSeconds": 1200,
          "durationSeconds": 2820,
          "progressPercent": 42.5,
          "lastPlayedAt": "2026-04-01T12:00:00.000Z"
        },
        "lastActivityAt": "2026-04-01T12:00:00.000Z",
        "payload": {}
      }
    ],
    "trackedSeries": [
      {
        "show": {
          "mediaType": "show",
          "kind": "title",
          "mediaKey": "show:tvdb:81189",
          "provider": "tvdb",
          "providerId": "81189",
          "parentMediaType": null,
          "parentProvider": null,
          "parentProviderId": null,
          "tmdbId": null,
          "showTmdbId": null,
          "seasonNumber": null,
          "episodeNumber": null,
          "absoluteEpisodeNumber": null,
          "title": "Breaking Bad",
          "subtitle": null,
          "summary": null,
          "overview": null,
          "artwork": {
            "posterUrl": null,
            "backdropUrl": null,
            "stillUrl": null
          },
          "images": {
            "posterUrl": null,
            "backdropUrl": null,
            "stillUrl": null,
            "logoUrl": null
          },
          "releaseDate": "2008-01-20",
          "releaseYear": 2008,
          "runtimeMinutes": 47,
          "rating": 9.5,
          "status": "ended"
        },
        "reason": "actively_watching",
        "lastInteractedAt": "2026-04-01T12:00:00.000Z",
        "nextEpisodeAirDate": null,
        "metadataRefreshedAt": "2026-04-01T12:00:00.000Z",
        "payload": {}
      }
    ],
    "limits": {
      "watchHistory": 100,
      "ratings": 100,
      "watchlist": 100,
      "continueWatching": 50,
      "trackedSeries": 25
    }
  }
}
```

### Field notes

#### `identity`

| Field | Type | Required | Notes |
|---|---|---|---|
| `accountId` | string | Yes | API Server account identifier |
| `profileId` | string | Yes | API Server profile identifier |

#### `generationMeta`

| Field | Type | Required | Notes |
|---|---|---|---|
| `sourceKey` | string | Yes | Recommendation lineage key. Today this defaults to `default`. |
| `algorithmVersion` | string | Yes | Server-selected algorithm version |
| `historyGeneration` | integer | Yes | Monotonic watch-data generation counter |
| `sourceCursor` | string or null | No | Opaque cursor/version marker |
| `ttlSeconds` | integer | No | Output TTL hint |

#### `watchHistory`, `ratings`, `watchlist`

These collections are arrays, not `{ limit, items }` envelopes.

- `watchHistory[]` item shape: `{ media, watchedAt, payload }`
- `ratings[]` item shape: `{ media, rating, payload }`
- `watchlist[]` item shape: `{ media, addedAt, payload }`

The `media` object follows the Server's current `RegularCardView` shape and always includes at least:

| Field | Type | Required |
|---|---|---|
| `media.mediaKey` | string | Yes |
| `media.mediaType` | string | Yes |
| `media.provider` | string | Yes |
| `media.providerId` | string | Yes |
| `media.title` | string | Yes |

The Server may also include additional read-only display fields such as poster URL, release year, rating, genre, and subtitle.

#### `profileContext`

| Field | Type | Required | Notes |
|---|---|---|---|
| `profileName` | string | Yes | Profile display name |
| `isKids` | boolean | Yes | Required in v1. This is the key profile attribute the Worker needs today. |
| `watchDataOrigin` | string | Yes | Server-side origin/source marker |

`pricingTier` is intentionally omitted from the Worker contract.

#### `aiConfig`

| Field | Type | Required | Notes |
|---|---|---|---|
| `providerId` | string | Yes | e.g. `openai`, `openrouter` |
| `endpointUrl` | string | Yes | Full provider endpoint |
| `httpReferer` | string | Yes | Provider header value when required |
| `title` | string | Yes | Provider header value when required |
| `model` | string | Yes | Server-selected model |
| `apiKey` | string | Yes | Sensitive secret. Never log it. |
| `credentialSource` | enum | Yes | `user`, `server`, or `shared_pool` |

#### `optionalExtras`

- `continueWatching[]` item shape: `{ id, media, progress, lastActivityAt, payload }`
- `trackedSeries[]` item shape: `{ show, reason, lastInteractedAt, nextEpisodeAirDate, metadataRefreshedAt, payload }`
- `limits` is included as metadata only; the Server remains responsible for truncating payload size before submission.

### Payload budgets

For v1, the API Server is responsible for truncation before submission.

| Collection | Current default limit |
|---|---|
| `watchHistory` | 100 |
| `ratings` | 100 |
| `watchlist` | 100 |
| `optionalExtras.continueWatching` | 50 |
| `optionalExtras.trackedSeries` | 25 |

The Worker should treat the submitted payload as the full user-data input for the job and should not refetch user/business data from the API Server.

### Submission response

#### `202 Accepted`

Used when a new job is created or an existing non-terminal job is reused.

```json
{
  "jobId": "gen_01HSXYZ",
  "status": "queued",
  "idempotencyKey": "recommendation:prof_456:default:v3:42",
  "acceptedAt": "2026-04-04T18:15:00.000Z",
  "statusUrl": "/v1/generations/gen_01HSXYZ",
  "pollAfterSeconds": 5
}
```

#### `200 OK`

Allowed for either:

- an idempotent replay when the matching job is already terminal and still retained, or
- a submit path that resolves immediately to an already-terminal retained job.

The body shape should remain the same as the `202` response envelope, except `status` may already be `succeeded`, `failed`, or `cancelled`.

### Submission status codes

| Status | Meaning |
|---|---|
| `200` | Idempotent replay resolved to an already terminal job |
| `202` | Accepted or deduped to an existing non-terminal job |
| `400` | Invalid request payload |
| `401` | Invalid or missing service auth |
| `409` | Same idempotency key used with a different effective request |
| `422` | Unsupported algorithm version or unsupported request contract |
| `429` | Worker temporarily cannot accept new jobs |
| `500` | Unexpected server error |
| `503` | Queueing/service temporarily unavailable |

---

## 7. Status Endpoint

### Endpoint

```text
GET /v1/generations/:jobId
```

### Supported status values

| Status | Meaning |
|---|---|
| `queued` | Accepted but not yet started |
| `running` | Execution has started |
| `succeeded` | Terminal success; final result is available |
| `failed` | Terminal failure; failure details are available |
| `cancelled` | Terminal cancellation |

### Status response envelope

```json
{
  "jobId": "gen_01HSXYZ",
  "status": "running",
  "idempotencyKey": "recommendation:prof_456:default:v3:42",
  "identity": {
    "accountId": "acc_123",
    "profileId": "prof_456"
  },
  "generationMeta": {
    "sourceKey": "default",
    "algorithmVersion": "v3",
    "historyGeneration": 42,
    "sourceCursor": "2026-04-04T10:15:00.000Z",
    "ttlSeconds": 86400
  },
  "acceptedAt": "2026-04-04T18:15:00.000Z",
  "startedAt": "2026-04-04T18:15:03.000Z",
  "completedAt": null,
  "cancelledAt": null,
  "result": null,
  "failure": null,
  "pollAfterSeconds": 10
}
```

### Field rules

| Field | Rule |
|---|---|
| `result` | Present only when `status = succeeded` |
| `failure` | Present only when `status = failed` or `status = cancelled` |
| `acceptedAt` | Present whenever known; should be included whenever the Worker accepted or reused the job |
| `startedAt` | Present when work has started |
| `completedAt` | Present for terminal success or failure |
| `cancelledAt` | Present when cancelled |
| `pollAfterSeconds` | Advisory polling hint for the API Server; may be omitted |

### Identity echo requirements

The status response should echo the original logical identity so the API Server can validate lineage without inferring from `jobId`.

| Field | Requirement |
|---|---|
| `identity.accountId` | Must match submitted `identity.accountId` |
| `identity.profileId` | Must match submitted `identity.profileId` |
| `generationMeta.sourceKey` | Must match submitted `generationMeta.sourceKey` |
| `generationMeta.algorithmVersion` | Must match submitted `generationMeta.algorithmVersion` |
| `generationMeta.historyGeneration` | Must match submitted `generationMeta.historyGeneration` |

### Status response codes

| Status | Meaning |
|---|---|
| `200` | Job found |
| `401` | Invalid or missing service auth |
| `404` | Unknown job ID or retained job expired after the retention window |
| `500` | Unexpected server error |

---

## 8. Successful Result Contract

When `status = succeeded`, the Worker returns the final generation result in `result`.

For v1, `result` reuses the current synchronous `RecommendationWorkerGenerateResponse` shape:

```json
{
  "result": {
    "tasteProfile": {
      "sourceKey": "default",
      "genres": ["crime", "thriller"],
      "preferredActors": ["Bryan Cranston"],
      "preferredDirectors": [],
      "contentTypePref": {
        "show": 0.7,
        "movie": 0.3
      },
      "ratingTendency": {
        "mean": 8.7
      },
      "decadePreferences": ["2000s", "2010s"],
      "watchingPace": "steady",
      "aiSummary": "Prefers intense serialized drama with strong character arcs.",
      "source": "recommendation_worker"
    },
    "recommendationSnapshot": {
      "sourceKey": "default",
      "algorithmVersion": "v3",
      "historyGeneration": 42,
      "sourceCursor": "2026-04-04T10:15:00.000Z",
      "generatedAt": "2026-04-04T18:17:45.000Z",
      "expiresAt": "2026-04-05T18:17:45.000Z",
      "source": "recommendation_worker",
      "sections": [
        {
          "id": "top_picks",
          "title": "Top Picks For You",
          "layout": "regular",
          "items": [
            {
              "mediaKey": "show:tvdb:121361",
              "mediaType": "show",
              "provider": "tvdb",
              "providerId": "121361",
              "title": "Better Call Saul",
              "posterUrl": "https://...",
              "releaseYear": 2015,
              "rating": 9,
              "reason": "Strong overlap in tone and long-form character development.",
              "score": 0.98,
              "rank": 1,
              "payload": {}
            }
          ],
          "meta": {
            "count": 1
          }
        }
      ]
    },
    "generation": {
      "providerId": "openai",
      "model": "gpt-4o",
      "credentialSource": "user",
      "completedAt": "2026-04-04T18:17:45.000Z",
      "tokensUsed": 12450
    }
  }
}
```

### Result requirements

#### Lineage fields must echo submission

The Worker must preserve these values in the final result:

| Field | Requirement |
|---|---|
| `tasteProfile.sourceKey` | Must match submitted `generationMeta.sourceKey` |
| `recommendationSnapshot.sourceKey` | Must match submitted `generationMeta.sourceKey` |
| `recommendationSnapshot.algorithmVersion` | Must match submitted `generationMeta.algorithmVersion` |
| `recommendationSnapshot.historyGeneration` | Must match submitted `generationMeta.historyGeneration` |

#### Empty result is valid

If the Worker cannot produce meaningful recommendation sections, it may still return success with:

```json
{
  "result": {
    "tasteProfile": { "sourceKey": "default" },
    "recommendationSnapshot": {
      "sourceKey": "default",
      "algorithmVersion": "v3",
      "historyGeneration": 42,
      "generatedAt": "2026-04-04T18:17:45.000Z",
      "expiresAt": null,
      "source": "recommendation_worker",
      "sections": []
    }
  }
}
```

`sections: []` is a valid success, not an error.

#### Canonical recommendation identities

Every returned recommendation item must include canonical identity fields:

| Field | Required |
|---|---|
| `mediaKey` | Yes |
| `mediaType` | Yes |
| `provider` | Yes |
| `providerId` | Yes |

Canonical recommendation identities are constrained to:

| Shape | Meaning |
|---|---|
| `movie:tmdb:*` | Movie recommendations |
| `show:tvdb:*` | Show recommendations |
| `anime:kitsu:*` | Anime recommendations |

#### Allowed section layouts

| Layout | Notes |
|---|---|
| `regular` | Standard media cards |
| `landscape` | Landscape media cards |
| `collection` | Curated grouped collection cards |
| `hero` | Highlighted hero cards |

The API Server sanitizes and persists these outputs; the Worker should stay within these layout families.

---

## 9. Failure Contract

There are two failure surfaces:

1. Immediate HTTP errors from the submit or status endpoint
2. Terminal job failures reported by `GET /v1/generations/:jobId`

### Immediate HTTP error envelope

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "historyGeneration must be a non-negative integer.",
    "details": {
      "field": "generationMeta.historyGeneration"
    }
  }
}
```

The API Server expects the human-readable error message to be available at `error.message` when this nested error envelope is used.

### Terminal job failure shape

```json
{
  "jobId": "gen_01HSXYZ",
  "status": "failed",
  "completedAt": "2026-04-04T18:17:45.000Z",
  "failure": {
    "code": "AI_RATE_LIMITED",
    "message": "Provider rate limit exceeded.",
    "retryable": true,
    "details": {
      "providerStatus": 429,
      "retryAfterSeconds": 30
    }
  }
}
```

### Standard failure codes

| Code | Where | Retryable | Meaning |
|---|---|---|---|
| `INVALID_REQUEST` | HTTP | No | Malformed request body |
| `UNAUTHORIZED` | HTTP | No | Missing or invalid service auth |
| `IDEMPOTENCY_CONFLICT` | HTTP | No | Same idempotency key, different request |
| `UNSUPPORTED_ALGORITHM` | HTTP | No | Unknown `algorithmVersion` |
| `QUEUE_UNAVAILABLE` | HTTP or terminal | Yes | Worker cannot currently accept or process work |
| `AI_PROVIDER_FAILURE` | Terminal | Yes | Upstream AI/provider failure |
| `AI_RATE_LIMITED` | Terminal | Yes | Provider rate limit |
| `AI_TIMEOUT` | Terminal | Yes | Provider timeout |
| `INTERNAL_ERROR` | HTTP or terminal | Yes | Unexpected worker failure |
| `CANCELLED` | Terminal | Usually no | Job was cancelled |

The `details` object is intentionally extensible.

`failure.details` must remain JSON-serializable.

---

## 10. AI Configuration Rules

The API Server resolves the AI configuration before submission. The Worker receives exactly one `aiConfig` per job.

### Rules

- The Worker may retry internally using the same `aiConfig`.
- The Worker must not switch AI providers or models on its own.
- If the Worker exhausts internal retries, it should mark the job as `failed`.
- The API Server may later submit a new logical generation with a different `aiConfig`, but that is outside the same job.

### Security requirements

- `aiConfig.apiKey` is sensitive.
- The Worker must never log the raw API key.
- If the Worker persists job payloads, secrets must be protected appropriately at rest.

---

## 11. Polling and Retry Guidance

### Submission retry guidance

- If the API Server is unsure whether a submission succeeded because of a network failure or timeout, it should retry the same `POST /v1/generations` call with the same `idempotency-key`.
- The API Server must not generate a new idempotency key for the same logical generation attempt.

### Polling guidance

- After a successful `POST`, the API Server should poll `GET /v1/generations/:jobId` until a terminal state is reached.
- The Worker may provide `pollAfterSeconds` as an advisory backoff hint.
- If no hint is provided, the API Server should default to a conservative polling interval such as 5 to 10 seconds.
- If the Worker returns a terminal `status` from the submit endpoint, the API Server may still call the status endpoint once to fetch the canonical terminal payload.
- The Worker should keep status reads idempotent and cheap; the API Server may perform recovery polling after restarts or after lost local delayed jobs.
- The Worker should not assume strict polling cadence. The API Server may poll later than requested because it persists its own recovery state and uses backoff.

### After terminal completion

- On `succeeded`, the API Server persists `tasteProfile` and `recommendationSnapshot` in its own storage.
- On `failed`, the API Server may log the failure, keep serving the last good snapshot, and decide whether to retry later as a new logical generation.

---

## 12. Versioning Strategy

- Endpoint versioning lives in the URL path: `/v1/generations`.
- Additive changes such as new optional fields do not require a new path version.
- Breaking changes such as renamed required fields or incompatible type changes require `/v2/...`.

### Algorithm version ownership

| Side | Responsibility |
|---|---|
| API Server | Chooses which `algorithmVersion` to send |
| Recommendation Worker | Documents which versions it supports |

For v1, unsupported algorithm versions should be rejected immediately at submission time with `422 UNSUPPORTED_ALGORITHM` when possible.

---

## 13. Async Contract Summary

Recommendation generation now uses the async contract:

```text
POST /v1/generations -> receive job reference
GET  /v1/generations/:jobId -> poll until terminal
```

### Migration principle

To reduce implementation churn:

- keep the generation request body shape the same as today's sync request body
- keep the success result payload shape the same as today's sync response body
- move only the execution lifecycle to async job semantics

This should let both teams evolve transport first and payload details second.

---

## 14. Remaining Alignment Questions

These do not block implementation starting, but they are the remaining contract edges worth closing explicitly.

| # | Question |
|---|---|
| 1 | What completed-job retention window do we want beyond the minimum 24 hours? |
| 2 | Do we want a future additive webhook/callback delivery mode, or is polling sufficient long-term? |
| 3 | What maximum request body size should the Worker enforce and reject with `400 INVALID_REQUEST`? |
| 4 | Should the Worker expose retry timing only through `pollAfterSeconds`, or also through `failure.details.retryAfterSeconds` for retryable terminal failures? |

## 15. API Server Assumptions Already Implemented

The current API Server async implementation already assumes the following Worker behaviors:

- submit requests are safe to retry with the same `idempotency-key`
- `GET /v1/generations/:jobId` returns `404` for unknown or expired retained jobs
- terminal jobs remain readable for at least 24 hours
- nested HTTP error envelopes populate `error.message`
- `pollAfterSeconds` is optional, not guaranteed
- terminal outcomes may be observed either on submit or on a follow-up status read

If the Worker team needs any of these assumptions changed, the contract and API Server should be updated together before cutover.

---

*End of async contract draft.*
