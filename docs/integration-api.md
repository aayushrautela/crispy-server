# Crispy Integration API Guide

This guide explains how external systems can read user profile activity, subscribe to account-level changes, and write recommendation lists into Crispy. It is intended for integrators building recommendation engines, analytics pipelines, agents, or automation around Crispy accounts.

For exact machine-readable schemas, field constraints, and future additions, use the published OpenAPI specification for your deployment as the source of truth. This guide focuses on practical usage patterns and examples.

## 1. Overview and architecture

The Integration API is an account-scoped API under:

```text
/api/integrations/v1
```

It is designed around four core concepts:

| Concept | Purpose |
| --- | --- |
| Account API key | Long-lived integration credential created by an authenticated Crispy user. |
| Profile | A viewer profile within the account. Most read/write resources are profile-scoped. |
| MediaRef | Provider-neutral identifier object used to describe movies, series, seasons, and episodes. |
| Recommendation list | A named, replaceable list of externally generated recommendations for a profile. |

Typical architecture:

```text
Crispy account/user
  ├─ creates API key
  ├─ has one or more profiles
  │    ├─ history: watched, watchlist, in-progress
  │    └─ recommendation lists written by integrations
  └─ emits account/profile change events

External integration
  ├─ stores API key securely
  ├─ polls profiles/history/changes
  ├─ resolves or maps media using MediaRef identities
  └─ PUTs recommendation lists with Idempotency-Key
```

Integration API reads are account-scoped: an API key can only access profiles and data owned by the account that created it. Recommendation writes are profile-scoped and associated with the API key's external recommendation source.

## 2. Authentication

### Creating an API key

API keys are created with normal Crispy user authentication, not with an existing integration key.

```bash
curl -X POST "$BASE_URL/api/integrations/v1/api-keys" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production recommender",
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }'
```

Response:

```json
{
  "key": {
    "id": "key_123",
    "name": "Production recommender",
    "keyPrefix": "F93xYk2aaQ0",
    "status": "active",
    "createdAt": "2026-04-29T12:00:00.000Z",
    "updatedAt": "2026-04-29T12:00:00.000Z",
    "lastUsedAt": null,
    "expiresAt": "2027-01-01T00:00:00.000Z",
    "revokedAt": null,
    "rotatedFromKeyId": null
  },
  "plaintextToken": "crispy_live_F93xYk2aaQ0_hV2...secret..."
}
```

`plaintextToken` is shown only once. Store it in a secret manager immediately.

API key token format:

```text
crispy_live_<prefix>_<secret>
```

The server stores only a hash of the secret. The `keyPrefix` is safe to display for identification, but the full token is secret.

### Using a key

Preferred authentication uses an HTTP Bearer token:

```bash
curl "$BASE_URL/api/integrations/v1/account" \
  -H "Authorization: Bearer $CRISPY_API_KEY"
```

The API also accepts `x-api-key` for clients that cannot set `Authorization`:

```bash
curl "$BASE_URL/api/integrations/v1/account" \
  -H "x-api-key: $CRISPY_API_KEY"
```

### Listing, revoking, and rotating keys

These operations require normal user authentication.

List keys:

```bash
curl "$BASE_URL/api/integrations/v1/api-keys" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"
```

Revoke a key:

```bash
curl -X DELETE "$BASE_URL/api/integrations/v1/api-keys/key_123" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"
```

Rotate a key:

```bash
curl -X POST "$BASE_URL/api/integrations/v1/api-keys/key_123/rotate" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production recommender - rotated",
    "expiresAt": "2027-06-01T00:00:00.000Z"
  }'
```

Rotation revokes the old key and returns a new `plaintextToken`.

## 3. Quick start

Set environment variables:

```bash
export BASE_URL="https://api.example.com"
export CRISPY_API_KEY="crispy_live_..."
```

Verify the account:

```bash
curl "$BASE_URL/api/integrations/v1/account" \
  -H "Authorization: Bearer $CRISPY_API_KEY"
```

Response:

```json
{
  "account": {
    "id": "acct_123"
  }
}
```

List profiles:

```bash
curl "$BASE_URL/api/integrations/v1/profiles" \
  -H "Authorization: Bearer $CRISPY_API_KEY"
```

Response:

```json
{
  "items": [
    {
      "id": "prof_alex",
      "name": "Alex",
      "avatarKey": "avatar-blue",
      "isKids": false,
      "sortOrder": 0,
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-04-28T18:20:00.000Z"
    }
  ]
}
```

Fetch recent history:

```bash
curl "$BASE_URL/api/integrations/v1/profiles/prof_alex/history?limit=50" \
  -H "Authorization: Bearer $CRISPY_API_KEY"
```

Write a recommendation list:

```bash
curl -X PUT "$BASE_URL/api/integrations/v1/profiles/prof_alex/recommendation-lists/weekend-picks" \
  -H "Authorization: Bearer $CRISPY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: recs-prof_alex-2026-04-29T12:00:00Z" \
  -d '{
    "title": "Weekend picks",
    "description": "Fresh recommendations based on recent watches",
    "algorithmKey": "hybrid-cf-v2",
    "modelVersion": "2026-04-29",
    "generatedAt": "2026-04-29T12:00:00.000Z",
    "expiresAt": "2026-05-06T12:00:00.000Z",
    "metadata": {
      "runId": "run_20260429_1200",
      "features": ["watch_history", "watchlist", "genre_affinity"]
    },
    "items": [
      {
        "mediaRef": {
          "mediaType": "movie",
          "providerIds": {
            "tmdb": 550,
            "imdb": "tt0137523"
          }
        },
        "metadataHint": {
          "title": "Fight Club",
          "releaseYear": 1999,
          "posterUrl": "https://image.tmdb.org/t/p/w500/example.jpg"
        },
        "score": 0.94,
        "reason": "Because Alex watched several dark psychological thrillers",
        "reasonCode": "similar_mood"
      }
    ]
  }'
```

## 4. Complete endpoint reference

### API key management

These endpoints use user authentication (`Authorization: Bearer $USER_ACCESS_TOKEN`).

#### `POST /api/integrations/v1/api-keys`

Create an account API key.

Request:

```json
{
  "name": "Production recommender",
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

Fields:

- `name` (required): non-empty display name.
- `expiresAt` (optional): ISO timestamp or `null` for no explicit expiry.

Response `201`:

```json
{
  "key": {
    "id": "key_123",
    "name": "Production recommender",
    "keyPrefix": "F93xYk2aaQ0",
    "status": "active",
    "createdAt": "2026-04-29T12:00:00.000Z",
    "updatedAt": "2026-04-29T12:00:00.000Z",
    "lastUsedAt": null,
    "expiresAt": "2027-01-01T00:00:00.000Z",
    "revokedAt": null,
    "rotatedFromKeyId": null
  },
  "plaintextToken": "crispy_live_F93xYk2aaQ0_hV2..."
}
```

#### `GET /api/integrations/v1/api-keys`

List account API keys.

Response:

```json
{
  "items": [
    {
      "id": "key_123",
      "name": "Production recommender",
      "keyPrefix": "F93xYk2aaQ0",
      "status": "active",
      "createdAt": "2026-04-29T12:00:00.000Z",
      "updatedAt": "2026-04-29T12:00:00.000Z",
      "lastUsedAt": "2026-04-29T12:05:22.000Z",
      "expiresAt": null,
      "revokedAt": null,
      "rotatedFromKeyId": null
    }
  ]
}
```

#### `DELETE /api/integrations/v1/api-keys/{keyId}`

Revoke a key. Revocation is safe to repeat.

Response:

```json
{
  "revoked": true,
  "key": {
    "id": "key_123",
    "name": "Production recommender",
    "keyPrefix": "F93xYk2aaQ0",
    "status": "revoked",
    "createdAt": "2026-04-29T12:00:00.000Z",
    "updatedAt": "2026-04-29T13:00:00.000Z",
    "lastUsedAt": "2026-04-29T12:05:22.000Z",
    "expiresAt": null,
    "revokedAt": "2026-04-29T13:00:00.000Z",
    "rotatedFromKeyId": null
  }
}
```

#### `POST /api/integrations/v1/api-keys/{keyId}/rotate`

Revoke an existing key and create a replacement.

Request:

```json
{
  "name": "Production recommender v2",
  "expiresAt": null
}
```

Response:

```json
{
  "key": {
    "id": "key_456",
    "name": "Production recommender v2",
    "keyPrefix": "Q8zv2p_2xYI",
    "status": "active",
    "createdAt": "2026-04-29T13:05:00.000Z",
    "updatedAt": "2026-04-29T13:05:00.000Z",
    "lastUsedAt": null,
    "expiresAt": null,
    "revokedAt": null,
    "rotatedFromKeyId": "key_123"
  },
  "plaintextToken": "crispy_live_Q8zv2p_2xYI_newSecret..."
}
```

### Integration account and profile reads

These endpoints use integration authentication (`Authorization: Bearer $CRISPY_API_KEY`).

#### `GET /api/integrations/v1/account`

Return the account associated with the API key.

Response:

```json
{
  "account": {
    "id": "acct_123"
  }
}
```

#### `GET /api/integrations/v1/profiles`

List profiles for the account.

Response:

```json
{
  "items": [
    {
      "id": "prof_alex",
      "name": "Alex",
      "avatarKey": "avatar-blue",
      "isKids": false,
      "sortOrder": 0,
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-04-28T18:20:00.000Z"
    }
  ]
}
```

#### `GET /api/integrations/v1/profiles/{profileId}`

Fetch a single profile owned by the account.

Response:

```json
{
  "profile": {
    "id": "prof_alex",
    "name": "Alex",
    "avatarKey": "avatar-blue",
    "isKids": false,
    "sortOrder": 0,
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-04-28T18:20:00.000Z"
  }
}
```

### History

#### `GET /api/integrations/v1/profiles/{profileId}/history`

List watched, watchlist, and in-progress state for a profile.

Query parameters:

| Parameter | Type | Default | Max | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | `100` | `500` | Number of items to return. Invalid or less-than-1 values fall back to default. |
| `cursor` | string | none | n/a | Cursor from previous response. |
| `updatedSince` | ISO timestamp | none | n/a | Only return rows with `updatedAt >= updatedSince`. |
| `includeDeleted` | boolean string | `false` | n/a | Set to `true` to include dismissed/deleted rows. |

Request:

```bash
curl "$BASE_URL/api/integrations/v1/profiles/prof_alex/history?limit=2&updatedSince=2026-04-01T00:00:00.000Z" \
  -H "Authorization: Bearer $CRISPY_API_KEY"
```

Response:

```json
{
  "items": [
    {
      "id": "content_001",
      "mediaRef": {
        "mediaType": "episode",
        "providerIds": {
          "tmdb": "1399"
        },
        "series": {
          "providerIds": {
            "tmdb": "1399"
          }
        },
        "seasonNumber": 1,
        "episodeNumber": 1
      },
      "status": "in_progress",
      "progress": {
        "positionSeconds": 1800,
        "durationSeconds": 3600,
        "progressPercent": 50
      },
      "lastActivityAt": "2026-04-29T10:30:00.000Z",
      "updatedAt": "2026-04-29T10:30:00.000Z",
      "isDeleted": false
    },
    {
      "id": "content_002",
      "mediaRef": {
        "mediaType": "movie",
        "providerIds": {
          "tmdb": "603"
        }
      },
      "status": "watched",
      "watchedAt": "2026-04-28T22:12:00.000Z",
      "updatedAt": "2026-04-28T22:12:00.000Z",
      "isDeleted": false
    }
  ],
  "pagination": {
    "nextCursor": "eyJ1cGRhdGVkQXQiOiIyMDI2LTA0LTI4VDIyOjEyOjAwLjAwMFoiLCJpZCI6ImNvbnRlbnRfMDAyIn0",
    "hasMore": true
  }
}
```

History statuses:

- `in_progress`: playback progress exists. Includes `progress` and `lastActivityAt`.
- `watched`: title was watched. May include `watchedAt`.
- `watchlist`: title is on the watchlist. Includes `addedAt` when available.

### Recommendation lists

Recommendation lists are full-replacement resources. A `PUT` replaces all list metadata and items for the same `{profileId, listKey}` and source.

`listKey` must match:

```text
^[a-zA-Z0-9._:-]{1,100}$
```

Each list can contain at most 500 items.

#### `PUT /api/integrations/v1/profiles/{profileId}/recommendation-lists/{listKey}`

Create or replace a recommendation list.

Headers:

| Header | Required | Description |
| --- | --- | --- |
| `Authorization: Bearer <api-key>` | yes | Integration API key. |
| `Content-Type: application/json` | yes | JSON body. |
| `Idempotency-Key` | recommended | Stable key for safe retries. |

Request:

```json
{
  "title": "Because you watched The Matrix",
  "description": "Cyberpunk, action, and reality-bending films",
  "algorithmKey": "hybrid-similarity-v3",
  "modelVersion": "2026-04-29.1",
  "generatedAt": "2026-04-29T12:00:00.000Z",
  "expiresAt": "2026-05-06T12:00:00.000Z",
  "metadata": {
    "runId": "run_abc123",
    "seedItems": ["tmdb:603"]
  },
  "items": [
    {
      "mediaRef": {
        "mediaType": "movie",
        "providerIds": {
          "tmdb": 550,
          "imdb": "tt0137523"
        }
      },
      "metadataHint": {
        "title": "Fight Club",
        "releaseYear": 1999,
        "genres": ["Drama", "Thriller"],
        "posterUrl": "https://image.tmdb.org/t/p/w500/example.jpg"
      },
      "score": 0.94,
      "reason": "Dark, philosophical tone with a cult following",
      "reasonCode": "mood_and_theme_match"
    }
  ]
}
```

Response:

```json
{
  "list": {
    "id": "rec_list_123",
    "profileId": "prof_alex",
    "sourceId": "src_key_123",
    "sourceKey": "api-key:F93xYk2aaQ0",
    "listKey": "because-you-watched-matrix",
    "title": "Because you watched The Matrix",
    "description": "Cyberpunk, action, and reality-bending films",
    "algorithmKey": "hybrid-similarity-v3",
    "modelVersion": "2026-04-29.1",
    "etag": "a4b91f...",
    "itemCount": 1,
    "generatedAt": "2026-04-29T12:00:00.000Z",
    "expiresAt": "2026-05-06T12:00:00.000Z",
    "createdAt": "2026-04-29T12:00:01.000Z",
    "updatedAt": "2026-04-29T12:00:01.000Z",
    "metadata": {
      "runId": "run_abc123",
      "seedItems": ["tmdb:603"]
    },
    "items": [
      {
        "id": "rec_item_001",
        "position": 0,
        "mediaRef": {
          "mediaType": "movie",
          "providerIds": {
            "tmdb": 550,
            "imdb": "tt0137523"
          }
        },
        "metadataHint": {
          "title": "Fight Club",
          "releaseYear": 1999,
          "genres": ["Drama", "Thriller"],
          "posterUrl": "https://image.tmdb.org/t/p/w500/example.jpg"
        },
        "score": 0.94,
        "reason": "Dark, philosophical tone with a cult following",
        "reasonCode": "mood_and_theme_match",
        "resolutionStatus": "unresolved",
        "resolvedContentId": null,
        "resolvedMediaKey": null,
        "resolvedAt": null,
        "resolutionError": null,
        "createdAt": "2026-04-29T12:00:01.000Z"
      }
    ]
  }
}
```

#### `GET /api/integrations/v1/profiles/{profileId}/recommendation-lists`

List recommendation list summaries.

Query parameters:

| Parameter | Description |
| --- | --- |
| `sourceKey` | Optional source filter. When omitted, returns lists for the current API key's default external source. |

Response:

```json
{
  "items": [
    {
      "id": "rec_list_123",
      "profileId": "prof_alex",
      "sourceId": "src_key_123",
      "sourceKey": "api-key:F93xYk2aaQ0",
      "listKey": "weekend-picks",
      "title": "Weekend picks",
      "description": "Fresh recommendations based on recent watches",
      "algorithmKey": "hybrid-cf-v2",
      "modelVersion": "2026-04-29",
      "etag": "a4b91f...",
      "itemCount": 20,
      "generatedAt": "2026-04-29T12:00:00.000Z",
      "expiresAt": "2026-05-06T12:00:00.000Z",
      "createdAt": "2026-04-29T12:00:01.000Z",
      "updatedAt": "2026-04-29T12:00:01.000Z",
      "metadata": {
        "runId": "run_20260429_1200"
      }
    }
  ]
}
```

#### `GET /api/integrations/v1/profiles/{profileId}/recommendation-lists/{listKey}`

Fetch a recommendation list including items.

Query parameters:

| Parameter | Description |
| --- | --- |
| `sourceKey` | Optional source filter. When omitted, uses the current API key's default external source. |

Response: same shape as the `PUT` response.

Not found response:

```json
{
  "error": "recommendation list not found"
}
```

### Change feed

#### `GET /api/integrations/v1/changes`

List account-level integration events.

Query parameters:

| Parameter | Type | Default | Max | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | `100` | `500` | Number of events to return. |
| `cursor` | string | none | n/a | Cursor from previous page. |

Request:

```bash
curl "$BASE_URL/api/integrations/v1/changes?limit=100" \
  -H "Authorization: Bearer $CRISPY_API_KEY"
```

Response:

```json
{
  "items": [
    {
      "id": "12345",
      "eventId": "evt_01HZY...",
      "accountId": "acct_123",
      "profileId": "prof_alex",
      "eventType": "profile.history.updated",
      "aggregateType": "profile_history",
      "aggregateId": "prof_alex",
      "eventVersion": 1,
      "occurredAt": "2026-04-29T10:30:00.000Z",
      "payload": {
        "profileId": "prof_alex",
        "changed": ["history"]
      },
      "createdAt": "2026-04-29T10:30:01.000Z"
    }
  ],
  "pagination": {
    "nextCursor": "eyJsYXN0SWQiOiIxMjM0NSJ9",
    "hasMore": true
  }
}
```

Use this endpoint to drive incremental syncs. Treat `eventType` and `payload` as evolvable; exact schemas should be read from the OpenAPI spec and changelog for your deployed version.

## 5. MediaRef format

`MediaRef` is the integration API's portable media identifier. It intentionally supports multiple identity strategies because external recommenders may know content by TMDB ID, IMDb ID, internal canonical IDs, season/episode numbers, or a mix of those.

Base shape:

```ts
type MediaRef = {
  mediaType: "movie" | "series" | "season" | "episode";
  canonicalId?: string;
  providerIds?: Record<string, string | number | Array<string | number>>;
  series?: {
    canonicalId?: string;
    providerIds?: Record<string, string | number | Array<string | number>>;
  };
  seasonNumber?: number;
  episodeNumber?: number;
  seasonProviderIds?: Record<string, string | number | Array<string | number>>;
  episodeProviderIds?: Record<string, string | number | Array<string | number>>;
};
```

Identity requirement: every recommendation item must include at least one usable identity:

- `canonicalId`, or
- non-empty `providerIds`, or
- non-empty `seasonProviderIds`, or
- non-empty `episodeProviderIds`, or
- `series.canonicalId`, or
- non-empty `series.providerIds`, or
- for `season`, a numeric `seasonNumber`, or
- for `episode`, numeric `seasonNumber` and `episodeNumber`.

Provider IDs are flexible. Common keys include `tmdb`, `imdb`, `tvdb`, `trakt`, or your own provider namespace:

```json
{
  "providerIds": {
    "tmdb": 603,
    "imdb": "tt0133093",
    "my_catalog": ["matrix-1999", "sku-441"]
  }
}
```

### Movie

Best when you know a title-level ID.

```json
{
  "mediaType": "movie",
  "providerIds": {
    "tmdb": 603,
    "imdb": "tt0133093"
  }
}
```

With a Crispy canonical content ID:

```json
{
  "mediaType": "movie",
  "canonicalId": "content_603"
}
```

### Series

Use for a show as a whole.

```json
{
  "mediaType": "series",
  "providerIds": {
    "tmdb": 1399,
    "imdb": "tt0944947"
  }
}
```

### Season

Use when recommending a particular season.

```json
{
  "mediaType": "season",
  "series": {
    "providerIds": {
      "tmdb": 1399
    }
  },
  "seasonNumber": 1,
  "seasonProviderIds": {
    "tmdb": 3624
  }
}
```

At minimum, a season can be identified by `mediaType: "season"` plus `seasonNumber`, but providing the parent `series` identity is strongly recommended.

### Episode

Use when recommending a specific episode.

```json
{
  "mediaType": "episode",
  "series": {
    "providerIds": {
      "tmdb": 1399,
      "imdb": "tt0944947"
    }
  },
  "seasonNumber": 1,
  "episodeNumber": 1,
  "episodeProviderIds": {
    "tmdb": 63056,
    "imdb": "tt1480055"
  }
}
```

At minimum, an episode can be identified by `mediaType: "episode"` plus numeric `seasonNumber` and `episodeNumber`, but this is ambiguous without a parent series identity. Always include `series.providerIds` or `series.canonicalId` when available.

### Metadata hints

Recommendation items may include a `metadataHint` object. Hints help display unresolved recommendations and improve later resolution.

```json
{
  "metadataHint": {
    "title": "The Matrix",
    "originalTitle": "The Matrix",
    "overview": "A hacker discovers reality is not what it seems.",
    "releaseYear": 1999,
    "releaseDate": "1999-03-31",
    "posterUrl": "https://image.tmdb.org/t/p/w500/example.jpg",
    "backdropUrl": "https://image.tmdb.org/t/p/w1280/example.jpg",
    "runtimeMinutes": 136,
    "genres": ["Action", "Science Fiction"],
    "rating": "R",
    "externalUrl": "https://www.themoviedb.org/movie/603"
  }
}
```

## 6. Pagination and cursor handling

Paginated endpoints return:

```json
{
  "pagination": {
    "nextCursor": "opaque-cursor",
    "hasMore": true
  }
}
```

Rules:

1. Treat cursors as opaque strings. Do not decode, construct, or modify them.
2. Pass `nextCursor` as `cursor` on the next request.
3. Stop when `hasMore` is `false` or `nextCursor` is `null`.
4. Keep the same query parameters across pages, especially `updatedSince`, `includeDeleted`, and `limit`.
5. For incremental history syncs, store both your high-water mark (`updatedAt`) and the last cursor while paging.

Example history pager:

```bash
cursor=""
while :; do
  url="$BASE_URL/api/integrations/v1/profiles/$PROFILE_ID/history?limit=500&updatedSince=$UPDATED_SINCE"
  if [ -n "$cursor" ]; then
    url="$url&cursor=$cursor"
  fi

  response=$(curl -s "$url" -H "Authorization: Bearer $CRISPY_API_KEY")
  # Process .items here.

  has_more=$(printf '%s' "$response" | jq -r '.pagination.hasMore')
  cursor=$(printf '%s' "$response" | jq -r '.pagination.nextCursor // empty')

  if [ "$has_more" != "true" ] || [ -z "$cursor" ]; then
    break
  fi
done
```

History cursors are based on descending `updatedAt` and item ID ordering. Change feed cursors are based on event ID ordering. Both are implementation details and may change without changing the public contract.

## 7. Idempotency and retry safety

### Safe reads

`GET` endpoints are safe to retry. If a network error occurs, retry with exponential backoff.

### Recommendation writes

Use `Idempotency-Key` on every `PUT /recommendation-lists/{listKey}` request.

The server stores the idempotency key for the tuple:

```text
source + profileId + listKey + idempotencyKey
```

It also stores a hash of the validated request body and `listKey`.

Behavior:

| Scenario | Result |
| --- | --- |
| First request with a new idempotency key | List is replaced and response is returned. |
| Retry with same key and same body | Original/current successful result is returned. |
| Retry with same key but different body | `409` conflict: `same idempotency key with different body`. |
| Retry after the idempotent result is unavailable | `409` conflict: `idempotent write result is no longer available`. |

Recommended key format:

```text
<job-name>:<profile-id>:<list-key>:<generation-timestamp-or-run-id>
```

Example:

```text
daily-recs:prof_alex:weekend-picks:2026-04-29T12:00:00Z
```

Retry policy:

- Retry network timeouts and HTTP `500`, `502`, `503`, `504`.
- Retry `429` if returned by your deployment/proxy, respecting `Retry-After` when present.
- Do not retry `400`, `401`, `403`, `404`, or validation errors without changing the request.
- On `409`, inspect the message. A reused idempotency key with a different body is a client bug.

## 8. Rate limits

The integration route implementation does not define an application-level per-endpoint rate limiter in the code paths documented here. Deployments may still enforce rate limits at the gateway, load balancer, CDN, or API platform layer.

Practical guidance:

- Design clients to handle `429 Too Many Requests` even if it is not emitted by local development.
- Respect `Retry-After` when present.
- Use exponential backoff with jitter for repeated `429` or transient `5xx` responses.
- Prefer incremental syncs with `updatedSince`, cursors, and `/changes` over frequent full scans.
- Use `limit=500` for bulk history/change pagination to reduce request count.
- Avoid parallel writes to the same `{profileId, listKey}`. Recommendation list writes are replacements, so concurrent writers can overwrite each other.

Example backoff schedule:

```text
1s, 2s, 4s, 8s, 16s, max 60s, with +/- 20% jitter
```

If your deployment publishes specific quotas in the OpenAPI spec or platform documentation, those limits supersede this general guidance.

## 9. Error handling

Most API errors use the standard error shape:

```json
{
  "code": "invalid_request",
  "message": "Request validation failed.",
  "details": [
    {
      "path": "/items/0/mediaRef/mediaType",
      "message": "must be equal to one of the allowed values",
      "keyword": "enum",
      "params": {}
    }
  ]
}
```

Some integration recommendation validation errors currently return a simpler shape:

```json
{
  "error": "items[0].mediaRef must include at least one identity"
}
```

Handle both shapes by checking `code/message` first and falling back to `error`.

Common statuses:

| Status | Meaning | Typical cause | Retry? |
| --- | --- | --- | --- |
| `400` | Bad request | Invalid body, invalid `listKey`, too many items, invalid `MediaRef`. | No. Fix request. |
| `401` | Unauthorized | Missing, malformed, revoked, expired, or invalid API key. | No, unless token refresh/rotation is in progress. |
| `404` | Not found | Profile/key/list does not exist or is not owned by account. | No. |
| `409` | Conflict | Idempotency key reused with a different body. | No. Use a new key or original body. |
| `422` | Unprocessable entity | Schema-level semantic validation, if enforced by deployment. | No. |
| `429` | Too many requests | Gateway/platform rate limit. | Yes, after `Retry-After`/backoff. |
| `500` | Internal error | Server failure. | Yes, with backoff. |
| `502`/`503` | Upstream unavailable | Temporary dependency or maintenance issue. | Yes, with backoff. |

Authentication errors:

Missing key:

```json
{
  "code": "missing_integration_api_key",
  "message": "Missing integration API key."
}
```

Invalid key:

```json
{
  "code": "invalid_integration_api_key",
  "message": "Invalid integration API key."
}
```

Validation examples from recommendation writes:

```json
{ "error": "listKey must match ^[a-zA-Z0-9._:-]{1,100}$" }
```

```json
{ "error": "items must contain at most 500 entries" }
```

```json
{ "error": "items[0].score must be a finite number" }
```

## 10. Example: building an autonomous recommender

This example describes a daily autonomous recommender that reads user activity, builds recommendations, and publishes lists back to Crispy.

### Data flow

```text
1. Poll /changes for account-level updates.
2. For changed profiles, fetch /profiles/{profileId}/history incrementally.
3. Build profile features from watched/watchlist/in-progress items.
4. Generate candidate MediaRefs with scores and reasons.
5. PUT /recommendation-lists/{listKey} with an Idempotency-Key.
6. Store cursors, high-water marks, list ETags, and run metadata.
```

### Suggested storage model

For each account/profile:

```json
{
  "accountId": "acct_123",
  "profileId": "prof_alex",
  "historyUpdatedSince": "2026-04-29T00:00:00.000Z",
  "historyCursor": null,
  "changesCursor": "eyJsYXN0SWQiOiIxMjM0NSJ9",
  "lastRecommendationRunId": "run_20260429_1200",
  "lastPublishedLists": {
    "weekend-picks": {
      "etag": "a4b91f...",
      "generatedAt": "2026-04-29T12:00:00.000Z"
    }
  }
}
```

### Pseudocode

```python
from datetime import datetime, timezone
import requests

BASE_URL = "https://api.example.com"
API_KEY = "crispy_live_..."
HEADERS = {"Authorization": f"Bearer {API_KEY}"}


def get(path, params=None):
    r = requests.get(f"{BASE_URL}{path}", headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def put(path, body, idempotency_key):
    headers = {
        **HEADERS,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
    }
    r = requests.put(f"{BASE_URL}{path}", headers=headers, json=body, timeout=60)
    r.raise_for_status()
    return r.json()


def sync_history(profile_id, updated_since):
    items = []
    cursor = None
    while True:
        params = {"limit": 500, "updatedSince": updated_since}
        if cursor:
            params["cursor"] = cursor
        page = get(f"/api/integrations/v1/profiles/{profile_id}/history", params)
        items.extend(page["items"])
        pagination = page["pagination"]
        if not pagination["hasMore"]:
            break
        cursor = pagination["nextCursor"]
    return items


def build_recommendations(history):
    # Replace this with your model. Return MediaRefs with score/reason metadata.
    return [
        {
            "mediaRef": {
                "mediaType": "movie",
                "providerIds": {"tmdb": 603, "imdb": "tt0133093"},
            },
            "metadataHint": {
                "title": "The Matrix",
                "releaseYear": 1999,
                "genres": ["Action", "Science Fiction"],
            },
            "score": 0.97,
            "reason": "High match for action and science fiction preferences",
            "reasonCode": "genre_affinity",
        }
    ]


def run_profile(profile_id):
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    history = sync_history(profile_id, "2026-04-01T00:00:00.000Z")
    items = build_recommendations(history)

    body = {
        "title": "Recommended for you",
        "description": "Updated daily from your Crispy activity",
        "algorithmKey": "autonomous-hybrid-v1",
        "modelVersion": "2026-04-29",
        "generatedAt": generated_at,
        "metadata": {
            "historyItemsUsed": len(history),
            "agent": "daily-autonomous-recommender",
        },
        "items": items[:500],
    }

    idempotency_key = f"daily-recs:{profile_id}:for-you:{generated_at}"
    return put(
        f"/api/integrations/v1/profiles/{profile_id}/recommendation-lists/for-you",
        body,
        idempotency_key,
    )


profiles = get("/api/integrations/v1/profiles")["items"]
for profile in profiles:
    run_profile(profile["id"])
```

### Production recommendations

- Generate separate lists for different jobs, for example `for-you`, `because-you-watched`, `new-to-you`, and `continue-the-vibe`.
- Include `algorithmKey`, `modelVersion`, and `metadata.runId` on every write.
- Include `reason` and `reasonCode` so clients can explain recommendations.
- Include `metadataHint` for unresolved or new catalog items.
- Cap output to 500 items per list.
- Use one deterministic `Idempotency-Key` per generated list version.
- Persist cursors after processing a page, not only at the end of a full run.
- Treat `/changes` as a signal to sync; fetch canonical state from `/history` before generating.

## 11. Changelog and versioning policy

The Integration API is versioned in the URL:

```text
/api/integrations/v1
```

### Compatibility expectations for `v1`

Within `v1`, clients should expect backward-compatible changes such as:

- New optional fields in responses.
- New `eventType` values in `/changes`.
- New fields inside event `payload` objects.
- New provider ID namespaces in `MediaRef` values.
- New recommendation `resolutionStatus` values if documented in the OpenAPI spec.
- Additional error details for validation failures.

Clients should therefore:

- Ignore unknown response fields.
- Treat enum-like strings defensively where the OpenAPI spec marks them extensible.
- Preserve opaque cursors exactly as returned.
- Use the OpenAPI spec for generated clients and schema validation.

### Breaking changes

Breaking changes require a new version path, for example:

```text
/api/integrations/v2
```

Examples of breaking changes:

- Removing or renaming response fields.
- Changing authentication semantics.
- Changing required request fields.
- Changing cursor compatibility in a way that invalidates active `v1` clients without a migration window.
- Changing `MediaRef` identity requirements incompatibly.

### Recommended client versioning

Send a clear `User-Agent` from integrations:

```text
User-Agent: acme-recommender/1.4.2 (+https://acme.example/support)
```

Track the API version and OpenAPI spec revision used to generate your client. When deploying a new recommender model, include `algorithmKey` and `modelVersion` in recommendation writes so list provenance is visible and auditable.

### OpenAPI reference

Use the OpenAPI spec published with your Crispy deployment for exact request and response schemas. This guide intentionally includes realistic examples and operational practices, while the OpenAPI spec should be treated as authoritative for:

- Field requiredness and nullability.
- Full schema definitions.
- Supported query parameters.
- Status codes and error schemas.
- Generated SDK/client code.
