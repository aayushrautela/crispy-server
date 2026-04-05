# Client Server Media State Contract

**Status:** Production contract
**Owner:** Engineering
**Last Updated:** 2026-04-03
**Source of truth:** public HTTP payloads returned by `src/http/routes/*` and enforced by `src/http/contracts/*`

## Purpose

This document defines the current client-facing contract for media navigation, runtime state, recommendation snapshot payloads, and metadata/detail responses.

This document is intentionally strict.

- It describes fields that are actually returned today.
- It separates guaranteed fields from layout-specific fields.
- It does not describe retired UUID-based client contracts.
- If this document conflicts with runtime route schemas under `src/http/contracts/*`, the route schemas win.

## Covered Endpoints

This contract applies to:

- `GET /v1/profiles/:profileId/home`
- `GET /v1/profiles/:profileId/calendar`
- `GET /v1/profiles/:profileId/library`
- `GET /v1/profiles/:profileId/watch/continue-watching`
- `GET /v1/profiles/:profileId/watch/watched`
- `GET /v1/profiles/:profileId/watch/watchlist`
- `GET /v1/profiles/:profileId/watch/ratings`
- `GET /v1/profiles/:profileId/watch/state`
- `POST /v1/profiles/:profileId/watch/states`
- `GET /v1/search/titles`
- `GET /v1/metadata/resolve`
- `GET /v1/metadata/titles/:mediaKey`
- `GET /v1/metadata/titles/:mediaKey/content`
- `GET /v1/metadata/titles/:mediaKey/seasons/:seasonNumber`
- `GET /v1/metadata/titles/:mediaKey/episodes`
- `GET /v1/metadata/titles/:mediaKey/next-episode`
- `GET /v1/metadata/people/:id`
- `GET /v1/playback/resolve`

## Contract Rules

### 1. Public navigation identity

The primary public navigation key is `mediaKey`.

When a payload includes `mediaKey`, clients should use it for:

- opening title detail
- requesting playback resolution
- watch state lookup
- title-to-title navigation

Supporting identity fields may also be present:

- `mediaType`
- `provider`
- `providerId`

Those fields are supporting metadata. They are not the preferred navigation contract when `mediaKey` is already present.

### 2. Internal IDs are not the client contract

Clients must not depend on internal canonical IDs, content UUIDs, or legacy detail targets on normal runtime cards.

If a screen needs richer data, the flow is:

1. read `mediaKey` from the current payload
2. call the relevant metadata or playback endpoint
3. render the richer response

### 3. Layout-specific payloads matter

Not every card-shaped object has the same identity guarantees.

- `regular` card surfaces include `mediaKey`
- `landscape` card surfaces include `mediaKey`
- metadata detail entities include `mediaKey` where documented below
- recommendation `hero` items now include `mediaKey`
- recommendation `collection` items do not currently include `mediaKey`

Clients must branch based on endpoint and layout instead of assuming every display object is universally navigable.

### 4. Continue-watching dismissal is per-item

Continue-watching items expose `dismissible`.

- if `dismissible` is `true`, the client may show dismiss UI
- if `dismissible` is `false`, the client must not show dismiss UI

Do not assume dismissal is universally available.

## Shared Shapes

### Regular card

Regular cards are used by:

- search results
- library items
- watched items
- watchlist items
- ratings items
- metadata `similar`
- metadata `collection.parts`
- person `knownFor`
- recommendation snapshot `regular` sections

Required fields:

```json
{
  "mediaType": "movie | show | anime | episode",
  "mediaKey": "string",
  "provider": "string",
  "providerId": "string",
  "title": "string",
  "posterUrl": "string",
  "releaseYear": "integer | null",
  "rating": "number | null",
  "genre": "string | null",
  "subtitle": "string | null"
}
```

### Landscape card

Landscape cards are used by:

- continue watching
- calendar items
- home runtime landscape sections
- recommendation snapshot `landscape` sections

Required fields:

```json
{
  "mediaType": "movie | show | anime | episode",
  "mediaKey": "string",
  "provider": "string",
  "providerId": "string",
  "title": "string",
  "posterUrl": "string",
  "backdropUrl": "string",
  "releaseYear": "integer | null",
  "rating": "number | null",
  "genre": "string | null",
  "seasonNumber": "integer | null",
  "episodeNumber": "integer | null",
  "episodeTitle": "string | null",
  "airDate": "string | null",
  "runtimeMinutes": "integer | null"
}
```

### Hero card

Hero cards are used only by recommendation snapshot `hero` sections.

Required fields:

```json
{
  "mediaKey": "string",
  "mediaType": "movie | show | anime | episode",
  "provider": "string",
  "providerId": "string",
  "title": "string",
  "description": "string",
  "backdropUrl": "string",
  "posterUrl": "string | null",
  "logoUrl": "string | null",
  "releaseYear": "integer | null",
  "rating": "number | null",
  "genre": "string | null"
}
```

### Recommendation collection card

Collection cards are display-only grouped recommendation payloads.

Collection section item shape:

```json
{
  "title": "string",
  "logoUrl": "string",
  "items": [
    {
      "mediaType": "movie | show | anime | episode",
      "provider": "string",
      "providerId": "string",
      "title": "string",
      "posterUrl": "string",
      "releaseYear": "integer | null",
      "rating": "number | null"
    }
  ]
}
```

Important:

- recommendation collection items do not currently guarantee `mediaKey`
- clients must not assume recommendation collection items are directly navigable via `mediaKey`

## Endpoint Contract

## `GET /v1/profiles/:profileId/home`

Envelope:

```json
{
  "profileId": "string",
  "source": "canonical_home",
  "generatedAt": "string",
  "runtime": {
    "continueWatching": {
      "id": "continue-watching",
      "title": "Continue Watching",
      "layout": "landscape",
      "source": "canonical_watch",
      "items": []
    },
    "thisWeek": {
      "id": "this-week",
      "title": "This Week",
      "layout": "landscape",
      "source": "canonical_calendar",
      "items": []
    }
  },
  "snapshot": {
    "sourceKey": "string | null",
    "generatedAt": "string | null",
    "sections": []
  }
}
```

### `home.runtime`

`runtime` is app-generated and user-state-driven.

Current sections are fixed:

- `continueWatching`
- `thisWeek`

`runtime.continueWatching.items` use the continue-watching item shape documented below.

`runtime.thisWeek.items` use the calendar item shape documented below.

### `home.snapshot`

`snapshot` is recommendation-engine output.

Current supported `layout` values:

- `regular`
- `landscape`
- `collection`
- `hero`

Section discriminators:

```json
{
  "id": "string",
  "title": "string",
  "layout": "regular | landscape | collection | hero",
  "items": "layout-specific array",
  "meta": {}
}
```

Layout-specific rules:

- `regular` section items are `{ media, reason, score, rank, payload }` where `media` is a regular card
- `landscape` section items are `{ media, reason, score, rank, payload }` where `media` is a landscape card
- `hero` section items are hero cards and include `mediaKey`
- `collection` section items are collection cards and do not guarantee `mediaKey`

Client guidance:

- branch rendering on `layout`
- do not try to normalize collection items into a universal navigation model without additional server support

## `GET /v1/profiles/:profileId/calendar`

Envelope:

```json
{
  "profileId": "string",
  "source": "canonical_calendar",
  "generatedAt": "string",
  "items": [
    {
      "bucket": "up_next | this_week | upcoming | recently_released | no_scheduled",
      "media": "LandscapeCard",
      "relatedShow": "RegularCard",
      "airDate": "string | null",
      "watched": "boolean"
    }
  ]
}
```

Notes:

- `media.mediaKey` is present and is the primary navigation key
- `relatedShow.mediaKey` is also present for the associated series/show card
- `bucket` is an explicit enum and clients should not assume additional undocumented bucket values

## `GET /v1/profiles/:profileId/library`

Envelope:

```json
{
  "profileId": "string",
  "source": "canonical_library",
  "generatedAt": "string",
  "auth": {
    "providers": [
      {
        "provider": "string",
        "connected": "boolean",
        "status": "string",
        "externalUsername": "string | null",
        "statusMessage": "string | null"
      }
    ]
  },
  "sections": [
    {
      "id": "string",
      "label": "string",
      "order": "integer",
      "itemCount": "integer"
    }
  ]
}
```

Notes:

- `/library` is section discovery only; it does not embed section items
- clients must render whatever `sections[]` the server returns
- clients must load actual library rows from `GET /v1/profiles/:profileId/library/sections/:sectionId`
- client apps should standardize on `/library/sections/:sectionId` for all library browsing

## `GET /v1/profiles/:profileId/library/sections/:sectionId`

Query:

```json
{
  "limit": "integer | string",
  "cursor": "string"
}
```

Envelope:

```json
{
  "profileId": "string",
  "source": "canonical_library",
  "generatedAt": "string",
  "section": {
    "id": "string",
    "label": "string",
    "order": "integer"
  },
  "items": [
    {
      "id": "string",
      "media": "RegularCard",
      "state": {
        "addedAt": "string | null",
        "watchedAt": "string | null",
        "ratedAt": "string | null",
        "rating": "number | null",
        "lastActivityAt": "string | null"
      },
      "origins": ["string"]
    }
  ],
  "pageInfo": {
    "nextCursor": "string | null",
    "hasMore": "boolean"
  }
}
```

Notes:

- use `media.mediaKey` for navigation
- do not expect legacy `detailsTarget`, `playbackTarget`, or `episodeContext` fields
- `sectionId` must come from the `/library` discovery response
- unknown `sectionId` returns `404`

## Watch Collection Endpoints

The following endpoints all return paginated canonical watch envelopes:

- `GET /v1/profiles/:profileId/watch/continue-watching`
- `GET /v1/profiles/:profileId/watch/watched`
- `GET /v1/profiles/:profileId/watch/watchlist`
- `GET /v1/profiles/:profileId/watch/ratings`

Shared envelope:

```json
{
  "profileId": "string",
  "kind": "continue-watching | watched | watchlist | ratings",
  "source": "canonical_watch",
  "generatedAt": "string",
  "items": [],
  "pageInfo": {
    "nextCursor": "string | null",
    "hasMore": "boolean"
  }
}
```

### Continue watching items

Shape:

```json
{
  "id": "string",
  "media": "LandscapeCard",
  "progress": {
    "positionSeconds": "number | null",
    "durationSeconds": "number | null",
    "progressPercent": "number",
    "lastPlayedAt": "string | null"
  } | null,
  "lastActivityAt": "string",
  "origins": ["string"],
  "dismissible": "boolean"
}
```

Important:

- continue-watching items do not currently include `watchedAt`
- clients must not require `watchedAt` on continue-watching rows

### Watched items

Shape:

```json
{
  "media": "RegularCard",
  "watchedAt": "string",
  "origins": ["string"]
}
```

### Watchlist items

Shape:

```json
{
  "media": "RegularCard",
  "addedAt": "string",
  "origins": ["string"]
}
```

### Ratings items

Shape:

```json
{
  "media": "RegularCard",
  "rating": {
    "value": "number",
    "ratedAt": "string"
  },
  "origins": ["string"]
}
```

## Watch State Endpoints

## `GET /v1/profiles/:profileId/watch/state`

Query:

```json
{
  "mediaKey": "string"
}
```

Response:

```json
{
  "profileId": "string",
  "source": "canonical_watch",
  "generatedAt": "string",
  "item": {
    "media": "RegularCard",
    "progress": {
      "positionSeconds": "number | null",
      "durationSeconds": "number | null",
      "progressPercent": "number",
      "status": "string",
      "lastPlayedAt": "string"
    } | null,
    "continueWatching": {
      "id": "string",
      "positionSeconds": "number | null",
      "durationSeconds": "number | null",
      "progressPercent": "number",
      "lastActivityAt": "string"
    } | null,
    "watched": {
      "watchedAt": "string"
    } | null,
    "watchlist": {
      "addedAt": "string"
    } | null,
    "rating": {
      "value": "number",
      "ratedAt": "string"
    } | null,
    "watchedEpisodeKeys": ["string"]
  }
}
```

Important:

- this endpoint is `mediaKey`-based
- clients must not call it with only provider fragments when `mediaKey` lookup is expected

## `POST /v1/profiles/:profileId/watch/states`

Request body:

```json
{
  "items": [
    { "mediaKey": "string" }
  ]
}
```

Response:

```json
{
  "profileId": "string",
  "source": "canonical_watch",
  "generatedAt": "string",
  "items": ["WatchStateItem"]
}
```

## `GET /v1/search/titles`

Response:

```json
{
  "query": "string",
  "items": ["RegularCard"]
}
```

Rules:

- every search item includes `mediaKey`
- use `mediaKey` for navigation
- do not assume internal IDs are present

## Metadata Endpoints

## `GET /v1/metadata/resolve`

Accepted query fields:

- `mediaKey`
- `imdbId`
- `mediaType`
- `provider`
- `providerId`
- `parentProvider`
- `parentProviderId`
- `seasonNumber`
- `episodeNumber`

Response:

```json
{
  "item": "MetadataView"
}
```

`MetadataView` includes a required `mediaKey` plus supporting identity and detail fields:

```json
{
  "mediaKey": "string",
  "mediaType": "string",
  "kind": "title | episode",
  "provider": "string",
  "providerId": "string",
  "parentMediaType": "string | null",
  "parentProvider": "string | null",
  "parentProviderId": "string | null",
  "tmdbId": "integer | null",
  "showTmdbId": "integer | null",
  "seasonNumber": "integer | null",
  "episodeNumber": "integer | null",
  "absoluteEpisodeNumber": "integer | null",
  "title": "string | null",
  "subtitle": "string | null",
  "summary": "string | null",
  "overview": "string | null",
  "artwork": {
    "posterUrl": "string | null",
    "backdropUrl": "string | null",
    "stillUrl": "string | null"
  },
  "images": {
    "posterUrl": "string | null",
    "backdropUrl": "string | null",
    "stillUrl": "string | null",
    "logoUrl": "string | null"
  },
  "releaseDate": "string | null",
  "releaseYear": "integer | null",
  "runtimeMinutes": "integer | null",
  "rating": "number | null",
  "status": "string | null",
  "certification": "string | null",
  "genres": ["string"],
  "externalIds": {
    "tmdb": "integer | null",
    "imdb": "string | null",
    "tvdb": "integer | null",
    "kitsu": "string | null"
  },
  "seasonCount": "integer | null",
  "episodeCount": "integer | null",
  "nextEpisode": "MetadataEpisodePreview | null"
}
```

## `GET /v1/metadata/titles/:mediaKey`

Response:

```json
{
  "item": "MetadataView",
  "seasons": ["MetadataSeasonView"],
  "videos": ["MetadataVideoView"],
  "cast": ["MetadataPersonRefView"],
  "directors": ["MetadataPersonRefView"],
  "creators": ["MetadataPersonRefView"],
  "reviews": ["MetadataReviewView"],
  "production": "MetadataProductionInfoView",
  "collection": {
    "id": "string | integer",
    "provider": "string",
    "providerId": "string",
    "name": "string",
    "posterUrl": "string | null",
    "backdropUrl": "string | null",
    "parts": ["RegularCard"]
  } | null,
  "similar": ["RegularCard"]
}
```

Identity guarantees:

- `item.mediaKey` is required
- `similar[*].mediaKey` is required
- `collection.parts[*].mediaKey` is required

## `GET /v1/metadata/titles/:mediaKey/content`

Response:

```json
{
  "item": "MetadataView",
  "content": "MDB-enriched content payload"
}
```

`item.mediaKey` remains the public identity field for the title.

## `GET /v1/metadata/titles/:mediaKey/seasons/:seasonNumber`

Response:

```json
{
  "show": "MetadataView",
  "season": "MetadataSeasonView",
  "episodes": ["MetadataEpisodeView"]
}
```

## `GET /v1/metadata/titles/:mediaKey/episodes`

Response:

```json
{
  "show": "MetadataView",
  "requestedSeasonNumber": "integer | null",
  "effectiveSeasonNumber": "integer",
  "includedSeasonNumbers": ["integer"],
  "episodes": ["MetadataEpisodeView"]
}
```

## `GET /v1/metadata/titles/:mediaKey/next-episode`

Response:

```json
{
  "show": "MetadataView",
  "currentSeasonNumber": "integer",
  "currentEpisodeNumber": "integer",
  "item": "MetadataEpisodeView | null"
}
```

## `GET /v1/metadata/people/:id`

Response:

```json
{
  "id": "string",
  "provider": "string",
  "providerId": "string",
  "tmdbPersonId": "integer",
  "name": "string",
  "knownForDepartment": "string | null",
  "biography": "string | null",
  "birthday": "string | null",
  "placeOfBirth": "string | null",
  "profileUrl": "string | null",
  "imdbId": "string | null",
  "instagramId": "string | null",
  "twitterId": "string | null",
  "knownFor": [
    {
      "mediaType": "string",
      "mediaKey": "string",
      "provider": "string",
      "providerId": "string",
      "tmdbId": "integer",
      "title": "string",
      "posterUrl": "string | null",
      "rating": "number | null",
      "releaseYear": "integer | null"
    }
  ]
}
```

Identity guarantee:

- `knownFor[*].mediaKey` is required

## `GET /v1/playback/resolve`

Response:

```json
{
  "item": "MetadataView",
  "show": "MetadataView | null",
  "season": "MetadataSeasonView | null"
}
```

Clients should continue using `mediaKey` as the public identity when moving from playback resolution back into title detail navigation.

## Navigation Matrix

The following matrix is the practical client rule set.

| Surface | `mediaKey` guaranteed | Notes |
| --- | --- | --- |
| Search item | Yes | Regular card |
| Library `item.media` | Yes | Regular card |
| Watched `item.media` | Yes | Regular card |
| Watchlist `item.media` | Yes | Regular card |
| Ratings `item.media` | Yes | Regular card |
| Continue watching `item.media` | Yes | Landscape card |
| Calendar `item.media` | Yes | Landscape card |
| Calendar `relatedShow` | Yes | Regular card |
| Home snapshot `regular` item `media` | Yes | Regular card |
| Home snapshot `landscape` item `media` | Yes | Landscape card |
| Home snapshot `hero` item | Yes | Hero card |
| Home snapshot `collection` inner item | No | Display-only today |
| Metadata detail `item` | Yes | MetadataView |
| Metadata detail `similar[*]` | Yes | Regular card |
| Metadata detail `collection.parts[*]` | Yes | Regular card |
| Person `knownFor[*]` | Yes | Person-known-for item |

## Client Guidance

Recommended client behavior:

1. render list and runtime payloads directly
2. use `mediaKey` whenever it is present
3. fetch metadata or playback detail on demand
4. branch on `layout` for recommendation snapshot sections
5. do not assume recommendation collection items are directly navigable

## Compatibility Notes

This contract does not preserve legacy UUID-first client behavior.

Clients must not assume:

- internal content UUIDs are present on normal cards
- continue-watching items contain `watchedAt`
- all recommendation layouts expose the same identity fields
- recommendation collection items include `mediaKey`
- old detail/playback targets are still part of the public surface
