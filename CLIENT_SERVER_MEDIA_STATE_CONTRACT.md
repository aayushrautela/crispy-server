# Client Server Media State Contract

**Status:** Current runtime contract
**Owner:** Engineering
**Source of truth:** `src/http/contracts/*` and the payloads emitted by `src/http/routes/*`

## Purpose

This document summarizes the current client-facing contract for media navigation, watch state, metadata, search, and recommendation payloads.

If this document conflicts with route schemas or runtime handlers, the route schemas win.

## Core Rules

### Public navigation identity

The canonical public navigation and media identity key is `mediaKey`.

When a payload includes `mediaKey`, clients should use it for:

- title navigation
- playback resolution
- watch state lookup
- watchlist and rating mutations

Supporting identity fields are deprecated or derived:

- `mediaType` is a derived convenience field from `mediaKey`; clients must not treat it as a separate identity.
- `provider` and `providerId` are deprecated canonical-shape fields and are removable from client-facing payloads.
- `contentId` is a legacy alias accepted during migration only; new payloads and clients should use `mediaKey`.

`mediaKey` is the stable public contract and source of truth.

### Current media types

Public payloads use these backend media types:

- `movie`
- `show`
- `episode`

There is no first-class backend `anime` media type anymore.

### Provider fields

Canonical metadata, watch payloads, and recommendation signal bundles identify media by `mediaKey`.

- `provider` and `providerId` are deprecated on canonical media shapes and may be removed.
- provider connection endpoints still refer to Trakt and Simkl as import providers.
- recommender signal bundles use `mediaKey`; `contentId` is a legacy alias accepted during migration only.

## Shared Shapes

### Regular card

```json
{
  "mediaType": "movie | show | episode",
  "mediaKey": "string",
  "title": "string",
  "posterUrl": "string",
  "releaseYear": "integer | null",
  "rating": "number | null",
  "genre": "string | null",
  "subtitle": "string | null"
}
```

### Landscape card

```json
{
  "mediaType": "movie | show | episode",
  "mediaKey": "string",
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

```json
{
  "mediaKey": "string",
  "mediaType": "movie | show | episode",
  "provider": "tmdb",
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

## Search Contract

### `GET /v1/search/titles`

The canonical search response is:

```json
{
  "query": "string",
  "all": ["RegularCard"],
  "movies": ["RegularCard"],
  "series": ["RegularCard"]
}
```

Rules:

- search is TMDB-only
- `series` maps to TMDB TV results
- there is no `anime` search bucket

## Metadata Resolve Contract

### `GET /v1/metadata/resolve`

Accepted query fields:

- `mediaKey`
- `tmdbId`
- `imdbId`
- `mediaType`
- `seasonNumber`
- `episodeNumber`
- `language`

There are no provider-routed resolve query fields anymore.

Response:

```json
{
  "item": "MetadataView"
}
```

### `MetadataView`

```json
{
  "mediaKey": "string",
  "mediaType": "movie | show | episode",
  "kind": "title | episode",
  "provider": "tmdb",
  "providerId": "string",
  "parentMediaType": "show | null",
  "parentProvider": "tmdb | null",
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
    "tvdb": "integer | null"
  },
  "seasonCount": "integer | null",
  "episodeCount": "integer | null",
  "nextEpisode": "MetadataEpisodePreview | null"
}
```

## Title Detail Contract

### `GET /v1/metadata/titles/:mediaKey`

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
    "provider": "tmdb",
    "providerId": "string",
    "name": "string",
    "posterUrl": "string | null",
    "backdropUrl": "string | null",
    "parts": ["RegularCard"]
  } | null,
  "similar": ["RegularCard"]
}
```

### `GET /v1/metadata/titles/:mediaKey/seasons/:seasonNumber`

This route returns season detail by show `mediaKey`.

```json
{
  "show": "MetadataView",
  "season": "MetadataSeasonView",
  "episodes": ["MetadataEpisodeView"]
}
```

### `GET /v1/playback/resolve`

```json
{
  "item": "MetadataView",
  "show": "MetadataView | null",
  "season": "MetadataSeasonView | null"
}
```

## Watch State Contract

### `GET /v1/profiles/:profileId/watch/state`

Query:

```json
{
  "mediaKey": "string"
}
```

Rules:

- this endpoint is `mediaKey`-based
- clients should not call it with provider fragments instead of `mediaKey`

### `POST /v1/profiles/:profileId/watch/states`

```json
{
  "items": [{ "mediaKey": "string" }]
}
```

## Recommendation Payload Rule

Recommendation items follow the same canonical media identity.

- `mediaKey` is required where the layout guarantees navigability
- `mediaType` is derived convenience only
- `provider` and `providerId` are deprecated/removable from canonical recommendation cards
- recommendation collection items may still omit `mediaKey` where the payload is display-only

## Provider Connections

Provider connection endpoints still refer to Trakt and Simkl as import providers.

That is separate from canonical metadata identity, which is TMDB-only.
