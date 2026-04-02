# Client Server Media State Contract

**Status:** Approved direction, implemented runtime contract
**Author:** Engineering
**Last Updated:** 2026-04-01
**Source of truth for:** client-facing runtime and metadata list/detail identity payloads

## Purpose

This document defines the current backend contract for runtime media state returned to Crispy clients.

This applies to:

- `GET /v1/profiles/:profileId/home`
- `GET /v1/profiles/:profileId/calendar`
- `GET /v1/profiles/:profileId/library`
- `GET /v1/profiles/:profileId/watch/continue-watching`
- `GET /v1/profiles/:profileId/watch/watched`
- `GET /v1/profiles/:profileId/watch/watchlist`
- `GET /v1/profiles/:profileId/watch/ratings`
- `GET /v1/search/titles`
- metadata detail payloads returned by:
  - `GET /v1/metadata/resolve`
  - `GET /v1/metadata/titles/:id`
  - `GET /v1/metadata/titles/:id/episodes`
  - `GET /v1/metadata/titles/:id/next-episode`
  - `GET /v1/playback/resolve`

## Core Direction

The backend now uses a simpler runtime model:

- list surfaces return lightweight cards
- richer metadata is fetched on demand
- clients should use provider-based identity for normal item interactions
- runtime and card-like metadata payloads should not depend on internal content UUIDs

## Shared Identity

For normal cards and landscape cards, the client should treat this as the primary identity:

- `media.mediaType`
- `media.provider`
- `media.providerId`

This is the canonical client-side reference for opening items and requesting richer metadata.

This same identity rule now applies to:

- runtime cards
- search results
- related/similar cards
- collection parts
- detail payload items where the payload is card-like

## Important Clarifications

### 1. `mediaKey`

`mediaKey` is **not guaranteed on watch-derived media cards** and should be treated as intentionally removed from normal card payloads.

Rules:

- do not rely on `media.mediaKey` for normal card rendering or click handling
- use `media.mediaType` + `media.provider` + `media.providerId` instead
- `mediaKey` still exists in some backend/state endpoints and internals, but it is not part of the main card contract clients should depend on

### 2. Continue Watching Dismissibility

Continue watching removal should **honor backend `dismissible` per item**.

Rules:

- if `dismissible` is `true`, client may show remove/dismiss affordance
- if `dismissible` is `false`, client should not offer dismiss/removal UI for that item
- Android should not treat continue-watching dismissal as universally available

## Card Families

### Regular Card

Used for:

- library rows
- watched rows
- watchlist rows
- rating rows
- normal recommendation rows
- other small-card list surfaces
- search results
- related/similar cards
- collection parts

Required fields:

- `media.mediaType`
- `media.provider`
- `media.providerId`
- `media.title`
- `media.posterUrl`

Optional cheap extras:

- `media.releaseYear`
- `media.rating`
- `media.genre`
- `media.subtitle`

### Landscape Card

Used for:

- continue watching
- this week
- calendar-like rows

Required fields:

- `media.mediaType`
- `media.provider`
- `media.providerId`
- `media.title`
- `media.posterUrl`
- `media.backdropUrl`

For episodic landscape cards, also expect:

- `media.seasonNumber`
- `media.episodeNumber`
- `media.episodeTitle`
- `media.airDate`
- `media.runtimeMinutes`

Landscape backdrop rule:

- prefer episode still/backdrop for episodic items
- otherwise use show/anime backdrop
- poster is the fallback visual source, but `backdropUrl` is still required in the returned contract

## Home Contract

`GET /v1/profiles/:profileId/home`

Home is split into two parts:

- `runtime`
- `snapshot`

### `runtime`

App-generated sections:

- `continueWatching`
- `thisWeek`

These are live/user-state-driven sections.

### `snapshot`

Recommendation-engine-driven sections:

- `sourceKey`
- `generatedAt`
- `sections[]`

Each snapshot section has a `layout`.

Currently supported layouts in the contract:

- `regular`
- `landscape`
- `collection`
- `hero`

Client should branch rendering based on `layout`.

## Search Contract

`GET /v1/search/titles`

Search results now follow the same lightweight provider-based regular-card model.

Client should assume each item contains:

- `mediaType`
- `provider`
- `providerId`
- `title`
- `posterUrl`
- optional cheap extras like `releaseYear`, `rating`, `subtitle`

Do not assume search results include canonical ids.

Use provider-based identity for navigation/open.

## Library Contract

`GET /v1/profiles/:profileId/library`

Each item includes:

- `id`
- `media`
- `state`
- `origins`

Do not expect:

- `detailsTarget`
- `playbackTarget`
- `episodeContext`

Use `media.mediaType` + `media.provider` + `media.providerId` to open details.

## Metadata Detail Contract

Full detail payloads are richer than runtime cards, but their client-facing identity has also been simplified.

### Important rule

Do not assume client-facing metadata detail payloads expose canonical/internal ids as the primary navigation contract.

For detail payloads, client should treat these as the stable identity fields:

- `mediaType`
- `provider`
- `providerId`

### Search/detail alignment

These card-like metadata structures now follow the same provider-based model as search/runtime cards:

- search result items
- `similar`
- `collection.parts`
- person `knownFor`

### Rich detail payloads

The server may still use internal canonical ids internally, but client should not depend on them for normal navigation or card rendering.

If a client needs richer detail:

1. keep provider-based identity from the current item
2. call metadata/detail/playback endpoints
3. render the richer response

For metadata title routes:

- `/v1/metadata/titles/:mediaKey`
- `/v1/metadata/titles/:mediaKey/content`
- `/v1/metadata/titles/:mediaKey/seasons/:seasonNumber`

clients should use title `mediaKey` values such as `movie:tmdb:487672`, `show:tmdb:1399`, `show:tvdb:121361`, or `anime:kitsu:1`.
Canonical internal UUID `content_id` values are internal-only and are not part of the client contract.

## Watch List Endpoints

These now return simple item shapes too:

- `/watch/continue-watching`
- `/watch/watched`
- `/watch/watchlist`
- `/watch/ratings`

For continue watching items, expect:

- `id`
- `media` as a landscape card
- `progress`
- `watchedAt`
- `lastActivityAt`
- `origins`
- `dismissible`

For watched/watchlist/ratings items, expect:

- `media` as a regular card
- relevant state fields
- `origins`

## Client Behavior Guidance

Recommended client flow:

1. render cards from runtime/list payloads
2. on click, use provider-based identity
3. ask the server for richer metadata/details on demand

Good mental model:

- runtime payloads are for fast rendering
- metadata endpoints are for detail screens
- user state stays separate from richer metadata
- provider-based identity should remain the default client navigation model across runtime, search, and related items

## Compatibility Note

This contract intentionally does not provide legacy fallbacks.

Rules:

- do not fall back to old UUID-based detail/playback fields
- do not assume internal content ids are present on normal cards
- do not assume `mediaKey` will be present on watch-derived card payloads
- do not assume every continue-watching item is dismissible
