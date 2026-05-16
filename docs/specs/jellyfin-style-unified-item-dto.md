# Jellyfin-Style Unified Item DTO Spec

## Status

- Target API contract for media item responses.
- Applied to all watch surfaces (continue watching, history, ratings, watchlist, watch state, calendar). **These surfaces are migrated.**
- Existing endpoints outside watch (search, details, collections, recommendations output) still produce legacy `MediaItem` — migrate as part of their surface work.
- Legacy `watchCacheRecordToMediaItem()` and the corresponding test have been removed. Use `watchCacheRecordToMediaItemDto()` for new work.
- Profile input signal bundle types (`ProfileInputSignalBundle` etc.) now use `MediaItemDto`.
- `metadataCardToMediaItem()` remains for surfaces that still consume `MediaItem`; new code should target DTO mappers.

## Goal

Use one predictable media item shape across the app, similar to Jellyfin's `BaseItemDto` model. Watchlist, continue watching, history, ratings, recommendations, search, details, and collection surfaces should all return the same item DTO whenever they represent media.

The endpoint should describe why the item appears in a list. The item DTO should describe what the media is. User-specific state should live in `userData`.

## Core principles

1. Do not create endpoint-specific media shapes.
2. Do not create special one-off fields such as `episode_image`, `continue_poster`, or `watchlistTitle`.
3. Return the playable item when the surface is about playback progress.
4. Return the title-level item when the surface is about title-level lists or discovery.
5. Keep media metadata separate from user state.
6. Preserve rich poster-card metadata: year, genres, maturity rating, rating, runtime, overview, and images.
7. Preserve typed image roles instead of flattening or losing artwork.
8. Use nullable or omitted type-specific fields rather than inventing different DTOs per media type.

## Canonical DTO

```ts
type MediaItemDto = {
  id: string;
  mediaKey: string;
  type: 'Movie' | 'Series' | 'Season' | 'Episode' | 'Unknown';

  name: string;
  originalTitle: string | null;
  overview: string | null;
  tagline: string | null;

  productionYear: number | null;
  premiereDate: string | null;
  communityRating: number | null;
  officialRating: string | null;
  certification: string | null;
  genres: string[];
  runTimeSeconds: number | null;
  status: string | null;

  providerIds: {
    tmdb: string | null;
    imdb: string | null;
    tvdb: string | null;
  };

  imageTags: MediaImageTags;
  parentImageTags: ParentMediaImageTags | null;

  seriesId: string | null;
  seriesName: string | null;
  seasonId: string | null;
  seasonName: string | null;
  parentIndexNumber: number | null;
  indexNumber: number | null;
  absoluteIndexNumber: number | null;
  episodeTitle: string | null;
  airDate: string | null;

  trailerUrl: string | null;
  trailerThumbnailUrl: string | null;

  userData: UserItemDataDto | null;
};
```

## Image model

Keep our responsive image sets, but organize them by Jellyfin-style image role.

```ts
type ImageSet = {
  small: string | null;
  medium: string | null;
  large: string | null;
};

type MediaImageTags = {
  primary: ImageSet | null;
  backdrop: ImageSet[];
  logo: ImageSet | null;
  thumb: ImageSet | null;
  screenshot: ImageSet[];
};

type ParentMediaImageTags = {
  primary: ImageSet | null;
  backdrop: ImageSet[];
  logo: ImageSet | null;
  thumb: ImageSet | null;
};
```

### Image meaning

| Role | Meaning | Current equivalent |
| --- | --- | --- |
| `primary` | Main poster or portrait artwork | `images.poster` |
| `backdrop` | Wide fanart/background artwork | `images.backdrop` |
| `logo` | Transparent logo/clearlogo | `images.logo` |
| `thumb` | Item thumbnail; for episodes this is the episode still | `images.still` for episodes |
| `screenshot` | Additional stills/screenshots | future expansion |
| `parentImageTags` | Show/season artwork available while rendering an episode | current parent + enriched show artwork |

Do not remove logo, poster, backdrop, or still support. The migration is a naming/semantic standardization, not a reduction in artwork.

## User data model

```ts
type UserItemDataDto = {
  itemId: string;
  isFavorite: boolean;
  played: boolean;
  playCount: number;
  playbackPositionSeconds: number | null;
  runtimeSeconds: number | null;
  playedPercentage: number | null;
  lastPlayedDate: string | null;
  rating: number | null;
  dismissedFromContinueWatching: boolean;
};
```

### User data rules

- `playbackPositionSeconds`, `runtimeSeconds`, `playedPercentage`, and `lastPlayedDate` represent resume/progress state.
- `played`, `playCount`, and `lastPlayedDate` represent watched history state.
- `isFavorite` represents watchlist/favorite membership.
- `rating` represents the profile's rating.
- `dismissedFromContinueWatching` is user state, not media metadata.

## Media type rules

### Movie

Movies use the same DTO with episode fields set to `null`.

Required poster-card fields:

- `name`
- `productionYear`
- `genres`
- `officialRating` / `certification`
- `communityRating`
- `runTimeSeconds`
- `imageTags.primary`
- `imageTags.backdrop`
- `imageTags.logo`
- `userData` when requested

### Series

Series use the same DTO with episode fields set to `null`.

Series-specific fields:

- `seriesId` may equal `id`
- `seriesName` may equal `name`
- `status`
- `genres`
- `productionYear`
- `imageTags.primary`
- `imageTags.backdrop`
- `imageTags.logo`

### Season

Seasons use the same DTO and include series context.

Season-specific fields:

- `seriesId`
- `seriesName`
- `seasonId`
- `seasonName`
- `parentIndexNumber` as the season number
- season artwork in `imageTags`
- series artwork may appear in `parentImageTags`

### Episode

Episodes use the same DTO and include series and season context.

Episode-specific fields:

- `name` is the episode name.
- `episodeTitle` is also the episode name for client clarity.
- `seriesName` is the parent show name.
- `seasonName` is the parent season name when available.
- `parentIndexNumber` is the season number.
- `indexNumber` is the episode number.
- `absoluteIndexNumber` is the absolute episode number when available.
- `airDate` is the episode air date.
- `imageTags.thumb` is the episode still.
- `parentImageTags` contains show/season fallback artwork.

## Endpoint behavior

### Continue watching / resume

Return playable items.

- Movie progress returns a `Movie` item.
- Episode progress returns an `Episode` item.
- Episode rows must include `seriesName`, season/episode numbers, `episodeTitle`, episode still, and parent show artwork when available.
- Resume progress lives in `userData`, not in custom continue-watching media fields.
- A wrapper may include list context such as `reason`, `lastActivityAt`, or pagination cursor, but the media object remains `MediaItemDto`.

### Watchlist / favorites

Return title-level items unless the user explicitly saved an episode or season.

- Saved movie returns `Movie`.
- Saved show returns `Series`.
- `isFavorite` must be true in `userData`.

### Ratings

Return the rated item with `userData.rating` populated.

- Do not create rating-specific media shapes.
- Rating timestamp may live in list context or a dedicated user-data extension if needed.

### Watch history

Return the played item.

- Movie play returns `Movie`.
- Episode play returns `Episode` with series context.
- Playback event metadata may live in list context.
- Watched state lives in `userData.played`, `userData.playCount`, and `userData.lastPlayedDate`.

### Recommendations and shelves

Return `MediaItemDto` plus shelf/list context.

- Recommendation score, reason, algorithm, and section id are not media fields.
- They belong beside the item in the list wrapper.

### Search and discovery

Return `MediaItemDto` with `userData` included when a profile is available and requested.

- Search result shape should not differ from recommendation/watchlist item shape.

## Wrapper shape

List endpoints may wrap media items with context, but the media object must stay canonical.

```ts
type ItemListEntryDto = {
  item: MediaItemDto;
  context: {
    source: 'continueWatching' | 'watchlist' | 'history' | 'ratings' | 'recommendation' | 'search' | string;
    reason?: string | null;
    occurredAt?: string | null;
    lastActivityAt?: string | null;
    sectionId?: string | null;
    sectionTitle?: string | null;
    dismissible?: boolean;
  };
};
```

## Current-field mapping

| Current field | Target field |
| --- | --- |
| `mediaKey` | `mediaKey` |
| `mediaType` | `type` |
| `title` | `name` |
| `originalTitle` | `originalTitle` |
| `overview` | `overview` |
| `releaseYear` | `productionYear` |
| `releaseDate` / `airDate` | `premiereDate` / `airDate` |
| `rating` | `communityRating` |
| `maturityRating` | `officialRating` |
| `certification` | `certification` |
| `runtimeMinutes` | `runTimeSeconds` |
| `images.poster` | `imageTags.primary` |
| `images.backdrop` | `imageTags.backdrop[0]` |
| `images.logo` | `imageTags.logo` |
| `images.still` | `imageTags.thumb` for episodes |
| `externalIds` | `providerIds` |
| `parent.title` | `seriesName` or `seasonName`, depending on parent type |
| `showTmdbId` | `seriesId` provider-derived id until canonical id exists |
| `seasonNumber` | `parentIndexNumber` |
| `episodeNumber` | `indexNumber` |
| `absoluteEpisodeNumber` | `absoluteIndexNumber` |
| `episodeTitle` | `episodeTitle` |
| `progress` / `continueWatching` | `userData.playbackPositionSeconds`, `runtimeSeconds`, `playedPercentage`, `lastPlayedDate` |
| `watchlist` | `userData.isFavorite` |
| `watched` / `playCount` | `userData.played`, `playCount`, `lastPlayedDate` |
| `rating.value` | `userData.rating` |

## Migration progress

| Step | Status |
| --- | --- |
| Add canonical DTO types (`MediaItemDto`, `MediaImageTags`, `ParentMediaImageTags`, `ProviderIds`, `UserItemDataDto`) | Done |
| Add `mediaItemToMediaItemDto()`, `watchCacheRecordToMediaItemDto()` mappers | Done |
| Migrate continue-watching surface to DTO | Done |
| Migrate history surface to DTO | Done |
| Migrate ratings surface to DTO | Done |
| Migrate watchlist surface to DTO | Done |
| Migrate watch-state surface to DTO | Done |
| Migrate calendar surface to DTO | Done |
| Migrate profile input signal types to DTO | Done |
| Remove legacy `watchCacheRecordToMediaItem()` | Done |
| Populate `userData` on watch surfaces | Pending |
| Migrate search surface to DTO | Pending |
| Migrate recommendations output surface to DTO | Pending |
| Migrate metadata-detail surface to DTO | Pending |
| Remove legacy `MediaItem` type | Pending (blocked on remaining surfaces) |

## Migration requirements

1. Add contract tests for Movie, Series, Season, and Episode examples.
2. Add explicit tests for episode continue-watching items:
   - `type = 'Episode'`
   - `name` and `episodeTitle` are populated
   - `seriesName` is populated
   - `imageTags.thumb` is populated from episode still when available
   - `parentImageTags.primary` or `parentImageTags.backdrop` is populated when show artwork is available
   - `userData.playbackPositionSeconds` and `playedPercentage` are populated

## Non-goals

- Do not exactly copy Jellyfin's PascalCase naming unless we intentionally expose a Jellyfin-compatible API.
- Do not remove responsive image sizes.
- Do not collapse all artwork into a single poster URL.
- Do not force movies, shows, seasons, and episodes into separate response DTOs.
- Do not make continue-watching a custom media schema.

## Acceptance criteria

A surface follows this spec when:

1. Every media result contains a canonical `MediaItemDto`.
2. Movies retain poster-card metadata: year, genres, maturity rating, rating, runtime, and images.
3. Episodes retain episode-specific metadata and parent series context.
4. User/profile state is represented in `userData` rather than custom media fields.
5. List-specific context is outside the media item.
6. Clients can render poster cards, wide resume cards, detail headers, and recommendation shelves from the same item shape.
