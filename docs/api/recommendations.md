# Recommendation API

Recommendation endpoints expose stored taste profiles and recommendation snapshots for an account-owned profile. All endpoints require authentication and operate on the `profileId` path parameter.

## Authorization

Requests must include a valid authenticated user session/token. The profile must belong to the authenticated account; otherwise the request fails with an authorization/not-found style error from profile access checks.

Required scopes:

| Endpoint | Scope |
| --- | --- |
| `GET /v1/profiles/:profileId/taste-profiles` | `taste-profile:read` |
| `GET /v1/profiles/:profileId/taste-profile` | `taste-profile:read` |
| `PUT /v1/profiles/:profileId/taste-profile` | `taste-profile:write` |
| `GET /v1/profiles/:profileId/recommendations` | `recommendations:read` |
| `PUT /v1/profiles/:profileId/recommendations` | `recommendations:write` |

## Common parameters

### Path parameters

- `profileId` string: account profile identifier.

### Query parameters

- `sourceKey` string, optional: recommendation source key. If omitted or invalid, the server resolves the configured default recommendation source key.
- `algorithmVersion` string, optional for `GET /recommendations`: recommendation algorithm version. If omitted or invalid, the server resolves the configured default algorithm version.

## Data available to the recommendation engine

When generating recommendations, the engine can receive a signal bundle for the target account/profile containing:

- `identity`: `accountId` and `profileId`.
- `generationMeta`: `sourceKey`, `algorithmVersion`, `historyGeneration`, optional `sourceCursor`, and optional `ttlSeconds`.
- `watchHistory`: recent watched media entries.
- `ratings`: profile rating signals.
- `watchlist`: media saved by the profile.
- `profileContext`: profile name, kids-profile flag, and watch-data origin.
- `aiConfig`: configured AI provider, endpoint URL, model, title, referer, API key, and credential source used internally for generation.
- `optionalExtras.continueWatching`: in-progress playback entries with media identity, progress, last activity, and optional payload.
- `optionalExtras.trackedSeries`: followed/tracked episodic titles.
- `optionalExtras.limits`: per-signal limits used while collecting watch history, ratings, watchlist, continue watching, and tracked series.

### Empty-data behavior

A profile is allowed to have no recommendation signals yet. If history, watchlist, ratings, continue-watching data, tracked series, or other collected user signals do not exist, the corresponding arrays in the signal bundle are empty (`[]`). Empty signal arrays are not an error and do not prevent generation by themselves. The generator may still create a taste profile and/or recommendation snapshot from defaults, catalog signals, editorial rules, AI behavior, or other configured sources.

Reading recommendations is snapshot-based:

- `GET /v1/profiles/:profileId/recommendations` returns the stored snapshot when one exists, even if one or more snapshot sections have empty `items` arrays or the snapshot has no sections.
- If no recommendation snapshot exists for the requested `profileId`, `sourceKey`, and `algorithmVersion`, the endpoint still returns HTTP `200` with `recommendations: null`. This no-snapshot state is not a `404`; `404 Not Found` is reserved for profile access failures such as a missing or inaccessible profile.

## Endpoints

### List taste profiles

`GET /v1/profiles/:profileId/taste-profiles`

Returns all stored taste profiles for the profile, across sources.

#### Response `200`

```json
{
  "items": [
    {
      "profileId": "profile_123",
      "sourceKey": "default",
      "genres": [],
      "preferredActors": [],
      "preferredDirectors": [],
      "contentTypePref": {},
      "ratingTendency": {},
      "decadePreferences": [],
      "watchingPace": null,
      "aiSummary": null,
      "source": "manual",
      "updatedByKind": "user",
      "updatedById": "user_123",
      "version": 1,
      "createdAt": "2026-05-02T10:00:00.000Z",
      "updatedAt": "2026-05-02T10:00:00.000Z"
    }
  ]
}
```

If none exist, `items` is an empty array.

### Get taste profile

`GET /v1/profiles/:profileId/taste-profile?sourceKey=default`

Returns the stored taste profile for a source.

#### Response `200`

```json
{
  "tasteProfile": {
    "profileId": "profile_123",
    "sourceKey": "default",
    "genres": [],
    "preferredActors": [],
    "preferredDirectors": [],
    "contentTypePref": {},
    "ratingTendency": {},
    "decadePreferences": [],
    "watchingPace": null,
    "aiSummary": null,
    "source": "generator",
    "updatedByKind": "service",
    "updatedById": null,
    "version": 1,
    "createdAt": "2026-05-02T10:00:00.000Z",
    "updatedAt": "2026-05-02T10:00:00.000Z"
  }
}
```

If no taste profile exists for the source, `tasteProfile` is `null`.

### Upsert taste profile

`PUT /v1/profiles/:profileId/taste-profile`

Creates or replaces a taste profile for the resolved `sourceKey`.

#### Request body

```json
{
  "sourceKey": "default",
  "genres": [],
  "preferredActors": [],
  "preferredDirectors": [],
  "contentTypePref": {},
  "ratingTendency": {},
  "decadePreferences": [],
  "watchingPace": null,
  "aiSummary": null,
  "source": "manual"
}
```

Field behavior:

- `sourceKey`: optional; defaults through server configuration when missing or invalid.
- Array fields default to `[]` when omitted or not arrays.
- Object fields default to `{}` when omitted or not objects.
- `watchingPace` and `aiSummary` are nullable strings.
- `source` defaults to `manual` when omitted or blank.

#### Response `200`

```json
{
  "tasteProfile": {
    "profileId": "profile_123",
    "sourceKey": "default",
    "genres": [],
    "preferredActors": [],
    "preferredDirectors": [],
    "contentTypePref": {},
    "ratingTendency": {},
    "decadePreferences": [],
    "watchingPace": null,
    "aiSummary": null,
    "source": "manual",
    "updatedByKind": "user",
    "updatedById": "user_123",
    "version": 2,
    "createdAt": "2026-05-02T10:00:00.000Z",
    "updatedAt": "2026-05-02T11:00:00.000Z"
  }
}
```

### Get recommendation snapshot

`GET /v1/profiles/:profileId/recommendations?sourceKey=default&algorithmVersion=v3.2.1`

Returns the latest stored recommendation snapshot for the profile/source/algorithm version.

#### Response `200` with snapshot

```json
{
  "recommendations": {
    "profileId": "profile_123",
    "sourceKey": "default",
    "historyGeneration": 4,
    "algorithmVersion": "v3.2.1",
    "sourceCursor": null,
    "generatedAt": "2026-05-02T10:00:00.000Z",
    "expiresAt": "2026-05-03T10:00:00.000Z",
    "source": "generator",
    "updatedByKind": "service",
    "updatedById": null,
    "sections": [
      {
        "id": "because-you-watched",
        "title": "Because you watched",
        "layout": "regular",
        "items": [
          {
            "media": {},
            "reason": "Similar mood and genre",
            "score": 0.92,
            "rank": 1,
            "payload": {}
          }
        ],
        "meta": {}
      }
    ],
    "updatedAt": "2026-05-02T10:00:00.000Z"
  }
}
```

`sections` may be empty. For any section, `items` may be empty.

#### Response `200` with no snapshot

```json
{
  "recommendations": null
}
```

This means no snapshot has been generated or stored for the requested profile/source/algorithm version. It is distinct from an empty snapshot, which has a non-null `recommendations` object with empty `sections` or section `items`.

### Upsert recommendation snapshot

`PUT /v1/profiles/:profileId/recommendations`

Creates or replaces the stored recommendation snapshot for the resolved `sourceKey` and `algorithmVersion`.

#### Request body

```json
{
  "sourceKey": "default",
  "historyGeneration": 4,
  "algorithmVersion": "v3.2.1",
  "sourceCursor": null,
  "generatedAt": "2026-05-02T10:00:00.000Z",
  "expiresAt": "2026-05-03T10:00:00.000Z",
  "source": "generator",
  "updatedById": null,
  "sections": []
}
```

Required fields:

- `historyGeneration`: non-negative integer.
- `generatedAt`: non-empty ISO timestamp string.

Field behavior:

- `sourceKey`: optional; defaults through server configuration when missing or invalid.
- `algorithmVersion`: optional; defaults through server configuration when missing or invalid.
- `sourceCursor` and `expiresAt` are nullable.
- `updatedById` is parsed when provided, but this account route writes the authenticated account id instead.
- `source` defaults to `manual` when omitted or blank.
- `sections` defaults to `[]` when omitted or not an array.

#### Section shapes

Recommendation snapshots can contain these section layouts:

```ts
type RecommendationSection =
  | {
      id: string;
      title: string;
      layout: "regular";
      items: Array<{
        media: RegularCardView;
        reason: string | null;
        score: number | null;
        rank: number | null;
        payload: Record<string, unknown>;
      }>;
      meta: Record<string, unknown>;
    }
  | {
      id: string;
      title: string;
      layout: "landscape";
      items: Array<{
        media: LandscapeCardView;
        reason: string | null;
        score: number | null;
        rank: number | null;
        payload: Record<string, unknown>;
      }>;
      meta: Record<string, unknown>;
    }
  | {
      id: string;
      title: string;
      layout: "collection";
      items: CollectionCardView[];
      meta: Record<string, unknown>;
    }
  | {
      id: string;
      title: string;
      layout: "hero";
      items: HeroCardView[];
      meta: Record<string, unknown>;
    };
```

#### Response `200`

```json
{
  "recommendations": {
    "profileId": "profile_123",
    "sourceKey": "default",
    "historyGeneration": 4,
    "algorithmVersion": "v3.2.1",
    "sourceCursor": null,
    "generatedAt": "2026-05-02T10:00:00.000Z",
    "expiresAt": "2026-05-03T10:00:00.000Z",
    "source": "generator",
    "updatedByKind": "user",
    "updatedById": "user_123",
    "sections": [],
    "updatedAt": "2026-05-02T10:00:00.000Z"
  }
}
```

## Status and error responses

- `200 OK`: request succeeded.
- `400 Bad Request`: validation failed. Current explicit validation includes:
  - `historyGeneration must be a non-negative integer.`
  - `generatedAt is required.`
- `401 Unauthorized`: missing or invalid authentication.
- `403 Forbidden`: authenticated principal lacks the required scope.
- `404 Not Found`: profile does not exist or is not accessible to the authenticated account.
- `5xx`: unexpected server, database, or upstream generation error.

Error bodies use the server's standard error response format for authentication, scope, validation, and profile-access failures.
