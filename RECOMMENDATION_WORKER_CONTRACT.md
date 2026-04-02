# Service Contract: API Server ↔ Recommendation Worker

**Status:** Agreed — ready for implementation
**Author:** Engineering
**Last Updated:** 2026-03-30
**Meeting Goal:** Align on contract before implementation begins

---

## 1. Purpose & Goals

This document defines the interface contract between **API Server** and **Recommendation Worker**. The API Server owns all data fetching, AI key resolution, and persistence. The Recommendation Worker becomes a stateless compute service: it receives a fully prepared payload, runs AI generation, and returns results.

The goals are: (1) establish a single, stable POST endpoint the API Server calls when it needs recommendations generated, (2) fully decouple orchestration from computation so the Worker never fetches data, resolves credentials, or writes to storage, and (3) make the Worker easy to scale, test, and replace independently.

---

## 2. Service Ownership Boundaries

| Area | Owner |
|---|---|
| Profile data | API Server |
| Watch history | API Server |
| Ratings | API Server |
| Watchlist | API Server |
| Continue watching / tracked series | API Server |
| AI key resolution & fallback | API Server |
| Active source management | API Server |
| Taste profile persistence | API Server |
| Recommendation snapshot persistence | API Server |
| Orchestration (load → resolve → build payload → call → persist → activate) | API Server |
| AI generation (prompt construction, model call, result parsing) | Recommendation Worker |
| Taste profile computation | Recommendation Worker |
| Recommendation section building | Recommendation Worker |

**Rule of thumb:** If it touches storage, credentials, or business logic about *when* to generate, it lives on the Server. If it transforms data into recommendations, it lives on the Worker.

---

## 3. The Contract

### Endpoint

```
POST /v1/generate
```

The Worker exposes one business endpoint for generation. The API Server calls it whenever it determines a generation is needed.

Operational endpoints such as `GET /health` or `GET /ready` may exist separately and are not part of the generation contract.

### Request Schema

```json
{
  "identity": {
    "accountId": "acc_9f8e7d6c",
    "profileId": "prof_abc123"
  },
  "generationMeta": {
    "sourceKey": "taste_prof_9f8e7d6c_abc123_v3",
    "algorithmVersion": "v3.2.1",
    "historyGeneration": 42,
    "sourceCursor": "2026-03-30T13:45:00Z",
    "ttlSeconds": 86400
  },
  "watchHistory": {
    "limit": 100,
    "items": [
      {
        "mediaKey": "movie:tmdb:550",
        "mediaType": "movie",
        "provider": "tmdb",
        "providerId": "550",
        "title": "Fight Club",
        "watchedAt": "2026-01-15T20:30:00Z",
        "plays": 2
      },
      {
        "mediaKey": "show:tvdb:1396",
        "mediaType": "show",
        "provider": "tvdb",
        "providerId": "1396",
        "title": "Breaking Bad",
        "watchedAt": "2026-02-10T21:00:00Z"
      },
      {
        "mediaKey": "anime:kitsu:1234",
        "mediaType": "anime",
        "provider": "kitsu",
        "providerId": "1234",
        "title": "Fullmetal Alchemist",
        "watchedAt": "2026-03-01T18:00:00Z"
      }
    ]
  },
  "ratings": {
    "limit": 100,
    "items": [
      {
        "mediaKey": "movie:tmdb:550",
        "mediaType": "movie",
        "provider": "tmdb",
        "providerId": "550",
        "title": "Fight Club",
        "rating": 8.5,
        "ratedAt": "2026-01-15T22:00:00Z"
      }
    ]
  },
  "watchlist": {
    "limit": 100,
    "items": [
      {
        "mediaKey": "show:tvdb:1396",
        "mediaType": "show",
        "provider": "tvdb",
        "providerId": "1396",
        "title": "Breaking Bad",
        "addedAt": "2026-02-01T10:00:00Z"
      }
    ]
  },
  "profileContext": {
    "language": "en",
    "region": "US",
    "isKids": false
  },
  "aiConfig": {
    "providerId": "openai",
    "model": "gpt-4o",
    "apiKey": "sk-...",
    "credentialSource": "user",
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "httpReferer": "https://app.example.com",
    "title": "Crispy Recommendations"
  },
  "optionalExtras": {
    "continueWatching": [
      {
        "mediaKey": "show:tvdb:1396",
        "mediaType": "show",
        "provider": "tvdb",
        "providerId": "1396",
        "title": "Breaking Bad",
        "lastWatchedAt": "2026-03-28T21:00:00Z"
      }
    ],
    "trackedSeries": [
      {
        "mediaKey": "show:tvdb:1396",
        "mediaType": "show",
        "provider": "tvdb",
        "providerId": "1396",
        "title": "Breaking Bad",
        "reason": "actively_watching",
        "lastInteractedAt": "2026-03-28T21:00:00Z"
      }
    ],
    "limits": {
      "continueWatching": 50,
      "trackedSeries": 25
    }
  }
}
```

#### Field Reference

**identity**

| Field | Type | Required | Description |
|---|---|---|---|
| `accountId` | string | Yes | Account identifier |
| `profileId` | string | Yes | Profile identifier within the account |

**generationMeta**

| Field | Type | Required | Description |
|---|---|---|---|
| `sourceKey` | string | Yes | Identifies the taste profile / snapshot lineage |
| `algorithmVersion` | string | Yes | Which algorithm config to use |
| `historyGeneration` | integer | Yes | Monotonic counter; Worker returns this unchanged |
| `sourceCursor` | string | No | Opaque cursor from the Server; for v1 this should normally be an ISO 8601 timestamp string when present |
| `ttlSeconds` | integer | No | Suggested cache lifetime in seconds. Worker may use this as a hint for `expiresAt`. Server always decides the final saved value. |

**mediaType enum**

Used across all item types. The API server collapses all watch activity to these three identity levels before sending:

| Value | Provider |
|---|---|
| `movie` | tmdb |
| `show` | tvdb |
| `anime` | kitsu |

Unknown `mediaType` values should be treated as an error (`400 INVALID_REQUEST`), not silently ignored.

**provider enum**

| Value | Description |
|---|---|
| `tmdb` | The Movie Database |
| `tvdb` | The TV Database |
| `kitsu` | Kitsu (anime) |

**Common item fields (watchHistory, ratings, watchlist)**

| Field | Type | Required | Description |
|---|---|---|---|
| `mediaKey` | string | Yes | Canonical identifier, e.g. `movie:tmdb:550` or `show:tvdb:1396` |
| `mediaType` | string | Yes | One of: `movie`, `show`, `anime` |
| `provider` | string | Yes | One of: `tmdb`, `tvdb`, `kitsu` |
| `providerId` | string | Yes | Provider-specific ID (e.g. `"550"` for TMDB movie) |
| `title` | string | Yes | Display title |

**watchHistory**

| Field | Type | Required | Description |
|---|---|---|---|
| `limit` | integer | Yes | Number of items the Server chose to include |
| `items` | array | Yes | Items follow the common item fields above |
| `watchedAt` | string (ISO 8601) | Yes | When the item was watched |
| `plays` | integer | No | Number of times played |

**ratings**

| Field | Type | Required | Description |
|---|---|---|---|
| `limit` | integer | Yes | Number of items the Server chose to include |
| `items` | array | Yes | Items follow the common item fields above |
| `rating` | number | Yes | Rating value |
| `ratedAt` | string (ISO 8601) | Yes | When the rating was given |

**watchlist**

| Field | Type | Required | Description |
|---|---|---|---|
| `limit` | integer | Yes | Number of items the Server chose to include |
| `items` | array | Yes | Items follow the common item fields above |
| `addedAt` | string (ISO 8601) | Yes | When the item was added to watchlist |

**profileContext**

| Field | Type | Required |
|---|---|---|
| `language` | string | No |
| `region` | string | No |
| `isKids` | boolean | No |

**aiConfig** — see Section 4.

**optionalExtras.continueWatching[]**

| Field | Type | Required | Description |
|---|---|---|---|
| All common item fields | | Yes | |
| `lastWatchedAt` | string (ISO 8601) | Yes | When the item was last watched |

The server collapses episode-level activity to the parent show/anime identity. The worker only needs to know the user is watching the show, not which episode.

**optionalExtras.trackedSeries[]**

| Field | Type | Required | Description |
|---|---|---|---|
| All common item fields | | Yes | |
| `reason` | string | Yes | Why the series is tracked |
| `lastInteractedAt` | string (ISO 8601) | Yes | When the user last interacted with the series |

**optionalExtras.limits**

| Field | Type | Required | Description |
|---|---|---|---|
| `continueWatching` | integer | Yes | Included item count budget for `continueWatching` |
| `trackedSeries` | integer | Yes | Included item count budget for `trackedSeries` |

### Payload Budget Rules

For v1, the API Server is responsible for truncation before calling the Worker. Default request budgets should match current server-side data loading behavior:

| Collection | Default Limit | Max Limit |
|---|---|---|
| `watchHistory.items` | 100 | 500 |
| `ratings.items` | 100 | 500 |
| `watchlist.items` | 100 | 500 |
| `optionalExtras.continueWatching` | 50 | 250 |
| `optionalExtras.trackedSeries` | 25 | 100 |

The Worker should treat the payload as already curated and should not perform its own refetching or pagination.

---

### Response Schema (200 OK)

```json
{
  "tasteProfile": {
    "sourceKey": "taste_prof_9f8e7d6c_abc123_v3",
    "genres": ["sci-fi", "thriller", "drama"],
    "preferredActors": ["Brad Pitt", "Edward Norton"],
    "preferredDirectors": ["David Fincher"],
    "contentTypePref": {
      "movie": 0.6,
      "show": 0.4
    },
    "ratingTendency": {
      "mean": 8.1,
      "lenient": true
    },
    "decadePreferences": ["1990s", "2000s"],
    "watchingPace": "binge",
    "aiSummary": "Prefers dark, cerebral thrillers with strong ensemble casts.",
    "source": "ai"
  },
  "recommendationSnapshot": {
    "sourceKey": "taste_prof_9f8e7d6c_abc123_v3",
    "algorithmVersion": "v3.2.1",
    "historyGeneration": 42,
    "sourceCursor": "2026-03-30T13:45:00Z",
    "generatedAt": "2026-03-30T14:00:05Z",
    "expiresAt": null,
    "source": "ai",
    "sections": [
      {
        "id": "top_picks",
        "title": "Top Picks For You",
        "items": [
          {
            "mediaKey": "movie:tmdb:680",
            "mediaType": "movie",
            "provider": "tmdb",
            "providerId": "680",
            "title": "Pulp Fiction",
            "reason": "Shares the nonlinear narrative style and dark humor you enjoy.",
            "score": 0.96,
            "rank": 1,
            "payload": {
              "confidence": "high"
            }
          }
        ],
        "meta": {
          "count": 1,
          "algorithmHint": "top"
        }
      }
    ]
  },
  "generation": {
    "providerId": "openai",
    "model": "gpt-4o",
    "credentialSource": "user",
    "completedAt": "2026-03-30T14:00:05Z",
    "tokensUsed": 12450
  }
}
```

---

### Response Field Notes

**`expiresAt`**

The Worker may return `expiresAt` as a suggested value, but the Server always controls the final value it persists. If the Worker returns `null`, the Server applies its own default TTL. The Server may override any Worker-provided value.

**`mediaKey` format**

`mediaKey` is optional. If present, it must follow this canonical format:

| Example | Meaning |
|---|---|
| `movie:tmdb:550` | Movie with TMDB ID 550 |
| `show:tvdb:1396` | Show with TVDB ID 1396 |
| `anime:kitsu:1234` | Anime with Kitsu ID 1234 |

When `mediaKey` is omitted, the Server derives the identity from individual fields (`mediaType`, `tmdbId`, `showTmdbId`, `seasonNumber`, `episodeNumber`). Both approaches work.

**Empty sections**

If the Worker cannot generate meaningful recommendation sections (e.g., thin watch history), it should return `200 OK` with `sections: []`. This is a valid result, not an error. The Server decides what to do with empty results: skip saving, expire quickly, or show a "not enough data" message to the user.

---

### Error Response Schema (4xx / 5xx)

```json
{
  "error": {
    "code": "AI_PROVIDER_FAILURE",
    "message": "OpenAI returned 429: rate limit exceeded",
    "details": {
      "providerStatus": 429,
      "failureKind": "rate_limit"
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `error.code` | string | Yes | Machine-readable error code |
| `error.message` | string | Yes | Human-readable description |
| `error.details` | object | No | Provider status code and failure kind |

---

## 4. AI Configuration

The API Server resolves all AI credentials **before** calling the Worker. The Worker receives a fully resolved config and calls the provider directly.

The contract intentionally uses a full provider `endpoint` plus optional provider-specific headers because that already matches the API Server's current AI client behavior and supports OpenAI-compatible providers such as OpenRouter cleanly. The Worker should be updated to support this shape rather than narrowing the contract to its current `baseUrl` implementation.

### aiConfig Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `providerId` | string | Yes | e.g. `"openai"`, `"anthropic"` |
| `model` | string | Yes | e.g. `"gpt-4o"`, `"claude-3-5-sonnet"` |
| `apiKey` | string | Yes | Resolved API key for this call |
| `credentialSource` | enum | Yes | One of: `user`, `server`, `shared_pool` |
| `endpoint` | string | Yes | Full URL the Worker should POST to |
| `httpReferer` | string | No | Referer header value for the provider call |
| `title` | string | No | Title header value for the provider call |

**credentialSource values:**

| Value | Meaning |
|---|---|
| `user` | User supplied their own API key |
| `server` | Server's default key |
| `shared_pool` | Shared pool key managed by the platform |

The Server handles credential resolution and selects one AI provider per request. The Worker receives exactly one `aiConfig` and makes the provider call. If the provider call fails, the Worker retries internally with the same config (same provider, same key, same model). The Worker does not switch providers. If the Worker exhausts its internal retries, it returns an error and the Server may send a new request with a different `aiConfig`.

---

## 5. Versioning Strategy

- The endpoint is versioned in the URL path: `/v1/generate`.
- Schema changes that are additive (new optional fields) do not require a new path version.
- Breaking changes (removed fields, changed types, renamed required fields) require bumping to `/v2/generate`.
- Both services should log the `algorithmVersion` for every request.

### algorithmVersion Ownership

| Side | Responsibility |
|---|---|
| API Server | Decides which `algorithmVersion` to send for each profile, based on server-side config or rollout flags |
| Recommendation Worker | Publishes a list of supported versions and documents what each version changes internally |

The version string is a key that maps to an internal config on the Worker side. The Server controls which key is used. If the Worker receives an unrecognized version, it returns `422 UNSUPPORTED_ALGORITHM`.

---

## 6. Authentication Between Services

| Mechanism | Details |
|---|---|
| Method | Internal service headers |
| Required headers | `x-service-id`, `x-api-key` |
| Token type | Service credential pair, not a user token |
| Rotation | Server-managed shared secret rotation |
| Scope | Authorize internal worker generation requests |

This aligns with the current service auth pattern already used by the API Server. Invalid or missing auth headers return `401 Unauthorized`.

---

## 7. Error Handling & Retries

### Error Codes

| Code | HTTP Status | Retry? | Meaning |
|---|---|---|---|
| `AI_PROVIDER_FAILURE` | 502 | Yes (with backoff) | Provider returned an error |
| `AI_RATE_LIMITED` | 429 | Yes (respect `Retry-After`) | Provider rate limit hit |
| `AI_TIMEOUT` | 504 | Yes | Provider call timed out |
| `INVALID_REQUEST` | 400 | No | Malformed payload — fix the request |
| `UNAUTHORIZED` | 401 | No | Bad or missing token |
| `UNSUPPORTED_ALGORITHM` | 422 | No | Worker does not recognize the algorithm version |
| `PARTIAL_GENERATION_NOT_SUPPORTED` | 422 | No | Worker could not fully build both outputs in v1 |
| `INTERNAL_ERROR` | 500 | Yes (with backoff) | Unexpected Worker failure |

### Retry Policy (Server Side)

- Max retries: **2** for retryable errors.
- Backoff: exponential, starting at 1 second, max 10 seconds.
- The Server treats repeated failures as a generation failure for that profile and logs accordingly.
- For v1, generation is all-or-nothing: if the Worker cannot produce both `tasteProfile` and `recommendationSnapshot`, it should return an error instead of partial results.

### Request IDs

- Every request includes an `X-Request-Id` header (UUID v4), set by the Server.
- The Worker **must** include the same `X-Request-Id` in its response and all log lines.
- If the Server does not provide one, the Worker generates one and returns it.

### Timeouts

| Timeout | Value |
|---|---|
| Connection timeout | 5 seconds |
| Overall request timeout | 120 seconds |
| AI provider call timeout (internal to Worker) | 90 seconds |

---

## 8. Observability

| Signal | Expectation |
|---|---|
| `X-Request-Id` | Present on every request and response |
| Structured logging | Both services emit JSON logs with `requestId`, `accountId`, `profileId`, `sourceKey` |
| Worker latency | Worker logs total duration and AI call duration separately |
| Token usage | Worker returns `tokensUsed` in response when available |
| Health | Worker should expose `GET /health` for liveness |

---

## 9. Rollout Plan

| Phase | Scope |
|---|---|
| 1. Contract agreement | Teams review and sign off on this document |
| 2. Worker skeleton | Worker implements `POST /v1/generate` with stub response |
| 3. Server integration | Server builds orchestration loop calling the Worker |
| 4. Shadow mode | Server calls Worker but discards output; compares to existing flow |
| 5. Canary | Server uses Worker output for a small percentage of requests |
| 6. Full rollout | Worker output is authoritative; legacy path is deprecated |
| 7. Cleanup | Remove legacy generation code from Server |

---

## 10. Open Questions

These need alignment before implementation starts.

| # | Question |
|---|---|
| 1 | Does the Worker need its own rate limiting? If so, what limits and how are they communicated back? |
| 2 | Should the Worker expose only `GET /health`, or both `GET /health` and `GET /ready`? |
| 3 | Do the default payload budgets in this document need adjustment before launch? |
| 4 | Should the Worker sign its response so the Server can verify it came from a trusted source? |

### Resolved Questions

| # | Resolution |
|---|---|
| algorithmVersion | Server decides which version to send. Worker declares supported versions. Unknown version returns 422. |
| expiresAt | Server owns final value. Worker may suggest via response, but Server applies its own default. Request includes optional `ttlSeconds` as a hint. |
| mediaKey | Optional in v1. Worker may return it in canonical format or omit it. Server derives identity from individual fields when omitted. |
| empty sections | Return 200 with `sections: []`. Not an error. Server decides how to handle empty results. |
| mediaType | Locked to `movie | show | anime`. Unknown values are an error. |
| request identity | Provider-aware. Movies use `tmdb`, shows use `tvdb`, anime use `kitsu`. Each item carries `mediaKey`, `mediaType`, `provider`, `providerId`. Season/episode data is collapsed to show-level by the server before sending. |
| AI fallback | Server resolves one AI provider per request. Worker retries internally with the same config on provider failure. Worker does not switch providers. |
| AI multi-provider | Resolved: one `aiConfig` per request. If worker fails, server may send a new request with a different config. |

---

*End of contract draft.*
