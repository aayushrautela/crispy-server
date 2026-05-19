# Identity v2 Spec

Status: draft for implementation planning. This does not change the active contract until the suites and fixtures are bumped.

## Problem

The current public identity contract mixes two models:

- Jellyfin-style DTO field names: `Id`, `SeriesId`, `SeasonId`, `ProviderIds`.
- Crispy provider-route keys in those fields: `show:tmdb:1396`, `episode:tmdb:1396:1:2`, and in some server paths raw TMDB ids such as `SeriesId = "1396"`.

That mix caused the homescreen episode bug: the backend emitted raw `SeriesId`, Android treated it as a route key, and `/v1/metadata/titles/1396` failed server parsing with `Unsupported media key format.`

Identity v2 makes the public API consistently Jellyfin-style:

- `Id` is an opaque stable Crispy item id.
- `SeriesId` and `SeasonId` are opaque stable Crispy parent item ids.
- `ProviderIds` contains external provider ids.
- TMDB is an external provider, not the public identity authority.

## Definitions

### Item id

An item id is the canonical public id for one content item.

Rules:

- It is opaque to clients.
- It is stable across sessions and devices.
- It is generated and resolved by the Crispy backend.
- It must not encode provider, media type, TMDB id, season number, or episode number.
- It is currently represented by `content_items.id` UUIDs.

Example:

```json
"Id": "8a1f7c85-2e86-4e2a-9c0b-77d9efc5a901"
```

### Provider ref

A provider ref maps one Crispy item id to an external id.

Rules:

- Stored in `content_provider_refs`.
- Uniqueness is `(provider, entity_type, external_id)`.
- One item may have multiple provider refs.
- TMDB refs are allowed but are not required by the public API shape.

Examples:

```json
{ "provider": "tmdb", "entity_type": "show", "external_id": "1396" }
{ "provider": "tvdb", "entity_type": "show", "external_id": "81189" }
{ "provider": "imdb", "entity_type": "movie", "external_id": "tt0111161" }
```

### Provider locator

A provider locator is an input-only compatibility or discovery identity used when the backend has not yet materialized an item id.

Rules:

- It may be accepted by resolve/search/import endpoints.
- It must be converted to an item id before being returned in `BaseItemDto.Id`.
- It must not be stored in user-state tables as the primary key after migration.
- The old `{type}:{provider}:{id}` media key format becomes a provider locator, not a public item id.

Examples:

```json
"movie:tmdb:550"
"show:tmdb:1399"
"episode:tmdb:1399:1:3"
```

## Public BaseItemDto identity shape

### Movie

```json
{
  "Id": "movie-content-uuid",
  "Type": "Movie",
  "Name": "Fight Club",
  "ProviderIds": {
    "Tmdb": "550",
    "Imdb": "tt0137523",
    "Tvdb": null
  },
  "SeriesId": null,
  "SeasonId": null,
  "ParentIndexNumber": null,
  "IndexNumber": null
}
```

### Series

```json
{
  "Id": "show-content-uuid",
  "Type": "Series",
  "Name": "Breaking Bad",
  "ProviderIds": {
    "Tmdb": "1396",
    "Imdb": "tt0903747",
    "Tvdb": "81189"
  },
  "SeriesId": null,
  "SeasonId": null,
  "ParentIndexNumber": null,
  "IndexNumber": null
}
```

### Season

```json
{
  "Id": "season-content-uuid",
  "Type": "Season",
  "Name": "Season 1",
  "ProviderIds": {
    "Tmdb": "1396:s1",
    "Imdb": null,
    "Tvdb": null
  },
  "SeriesId": "show-content-uuid",
  "SeasonId": null,
  "ParentIndexNumber": null,
  "IndexNumber": 1
}
```

### Episode

```json
{
  "Id": "episode-content-uuid",
  "Type": "Episode",
  "Name": "Pilot",
  "ProviderIds": {
    "Tmdb": "1396:s1:e1",
    "Imdb": "tt0959621",
    "Tvdb": null
  },
  "SeriesId": "show-content-uuid",
  "SeasonId": "season-content-uuid",
  "ParentIndexNumber": 1,
  "IndexNumber": 1
}
```

## Parent identity rules

- `SeriesId` is set only for season and episode items.
- `SeriesId` must be the parent series item id, never a TMDB id and never a media key.
- `SeasonId` is set only for episode items when the backend has materialized the season item.
- `SeasonId` must be the parent season item id, never `season:tmdb:*` and never a raw season number.
- `SeriesName`, `SeasonName`, `ParentImageTags`, `ParentIndexNumber`, and `IndexNumber` remain descriptive metadata and are not identity authorities.

## Route rules

### Preferred routes

The backend should expose item-id routes:

```text
GET /v1/metadata/items/:itemId
GET /v1/metadata/items/:itemId/extras
GET /v1/profiles/:profileId/metadata/items/:itemId/reviews
GET /v1/profiles/:profileId/metadata/items/:itemId/ratings
PUT /v1/profiles/:profileId/watch/watchlist/:itemId
DELETE /v1/profiles/:profileId/watch/watchlist/:itemId
PUT /v1/profiles/:profileId/watch/rating/:itemId
DELETE /v1/profiles/:profileId/watch/rating/:itemId
DELETE /v1/profiles/:profileId/watch/continue-watching/:itemId
```

### Compatibility routes

Existing `:mediaKey` routes may remain during migration, but they must be treated as provider locator routes:

```text
GET /v1/metadata/titles/:mediaKey
GET /v1/metadata/titles/:mediaKey/extras
```

Compatibility route behavior:

1. Parse old media key as provider locator.
2. Ensure or resolve a Crispy item id.
3. Continue internally with the item id.
4. Return DTOs whose `Id`, `SeriesId`, and `SeasonId` are item ids.

## User-state identity rules

After migration, user-state tables must use item ids as primary media identity:

- `watch_events.media_key` becomes item-id content in-place or is renamed to `item_id`.
- `watch_events.title_media_key` becomes `title_item_id`.
- `playback_progress.title_media_key` becomes `title_item_id`.
- `playback_progress.playable_media_key` becomes `playable_item_id`.
- `media_watch_summary.media_key` becomes `item_id`.
- `media_watch_summary.title_media_key` becomes `title_item_id`.
- `profile_list_items.media_key` becomes `item_id`.
- `profile_ratings.media_key` becomes `item_id`.
- `watch_media_card_cache.media_key` becomes `item_id`.

If column renames are deferred, the column names may temporarily remain `media_key`, but values must be item ids and code must stop parsing them as provider media keys.

## Watch and continue-watching rules

- Continue-watching rows identify two things:
  - `titleItemId`: movie or series item id for grouping and details navigation.
  - `playableItemId`: movie or episode item id for playback.
- Movie playback uses the same id for title and playable item.
- Episode playback uses the series id as `titleItemId` and the episode id as `playableItemId`.
- The public `BaseItemDto` for continue watching is the playable item.
- Its `SeriesId` must contain the parent series item id.
- Its `UserData.ItemId` must contain the playable item id.
- Dismiss continue-watching operates on `titleItemId`.

## Playback resolution rules

Playback resolution should prefer item ids:

```text
GET /v1/playback/resolve?itemId=:itemId
```

Resolution behavior:

1. Resolve the item id to content item + provider refs.
2. If the item is an episode, resolve parent series and season relationships.
3. Choose the best provider locator required by the selected playback provider.
4. Return stream/playback data without exposing the provider locator as the item's public id.

Compatibility inputs may remain:

```text
GET /v1/playback/resolve?mediaKey=episode:tmdb:1396:1:1
GET /v1/playback/resolve?tmdbId=1396&mediaType=episode&seasonNumber=1&episodeNumber=1
```

Compatibility inputs must be materialized to item ids before watch state is written.

## Search and recommendations rules

- Search results must call identity materialization before returning title items.
- Recommendation items must store and emit item ids, not media keys.
- `item_key` in search-ranking contracts should become an opaque route key backed by item id for title results.
- Person results may keep a separate person route id, but it should also be opaque once person identity is materialized.

## Calendar rules

- Calendar episode `Id` is the episode item id.
- Calendar episode `SeriesId` is the series item id.
- Calendar episode `SeasonId` is the season item id when available.
- Calendar home navigation must use `SeriesId` for title/details and `Id` for playback/highlight.
- No calendar client code may derive a series id by parsing an episode id.

## ProviderIds rules

`ProviderIds` remains the only public place for external provider ids.

Current required keys:

```json
{
  "Tmdb": "1396",
  "Imdb": "tt0903747",
  "Tvdb": "81189"
}
```

Future-compatible behavior:

- Unknown provider keys may be added by the server.
- Clients may read known keys and ignore unknown keys.
- Missing provider ids must be represented as `null`, not by overloading `Id` or parent id fields.

## Server identity rules

- `parseMediaKey` remains only a provider-locator parser.
- `ContentIdentityService.ensureContentId` is the boundary from provider locator to item id.
- `ContentIdentityService.resolveContentReference` is the boundary from item id to provider refs.
- `selectAuthorityRef` must stop assuming TMDB is always present once multiple authority providers are supported.
- Provider-specific metadata services may still use TMDB internally during phase 1, but public route identity must not require TMDB-shaped ids.

## Android client rules

- `CrispyBackendClient.MediaItem.mediaKey` should be renamed or semantically treated as `itemId`.
- `seriesId` is a parent item id, not a TMDB id.
- `showTmdbId = item.seriesId?.toIntOrNull()` is invalid under Identity v2 and must be replaced by `ProviderIds.Tmdb` or parent item resolution.
- Homescreen, continue-watching, calendar, details, watchlist, ratings, and playback must pass item ids to backend item-id routes.
- Client code must not build episode ids by formatting `episode:tmdb:{showId}:{season}:{episode}` except when explicitly calling a compatibility provider-locator endpoint.

## Contract suite changes

Affected suites and required version bumps:

- `media_state_contract`: v5
- `watch_collections_contract`: v4
- `calendar_contract`: v4
- `home_catalogs`: v6
- `search_ranking_and_dedup`: v5

Required fixture changes:

- Replace public `Id` values such as `movie:tmdb:123` with opaque item ids.
- Replace episode `SeriesId` values such as `1396` or `show:tmdb:1396` with opaque series item ids.
- Replace episode `SeasonId` values with opaque season item ids where available.
- Keep `ProviderIds.Tmdb` populated where TMDB data exists.
- Rename normalized expected fields from `media_key` to `item_id` where contract-runner output represents public identity.
- Add explicit negative fixtures proving raw TMDB ids and media keys are invalid as `SeriesId` under v5/v4 contracts.

## Compatibility window

During migration, the backend may accept:

- old media keys in route params and query params,
- `tmdbId` resolve inputs,
- old persisted user-state rows containing media keys.

But the backend must emit only item ids in public DTO identity fields once an endpoint is switched to Identity v2.

## Completion criteria

Identity v2 is complete when:

- No public `BaseItemDto.Id` value contains `:`.
- No public `SeriesId` or `SeasonId` value is a raw number or contains `:`.
- Android homescreen episode navigation never sends raw TMDB ids to metadata routes.
- Watch state, continue watching, watchlist, ratings, history, recommendations, search, calendar, and playback all use item ids for public item identity.
- TMDB can be absent from `ProviderIds` for a supported item without breaking public route identity.
