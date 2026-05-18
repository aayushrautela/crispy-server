# Jellyfin-Style Unified Item DTO Spec

## Status

- Applied to all public media item responses.
- All surfaces (continue watching, history, ratings, watchlist, watch state, calendar, search, recommendations, metadata detail/extras, AI search) return the canonical `BaseItemDto`.
- Legacy aliases (`MediaItemDto`, `mediaItemToMediaItemDto`) removed.

## Goal

Use one predictable media item shape across the app, matching Jellyfin's `BaseItemDto` model. Every surface that represents media returns the same item DTO.

## Core principles

1. Do not create endpoint-specific media shapes.
2. Do not create special one-off fields.
3. Return the playable item when the surface is about playback progress.
4. Return the title-level item when the surface is about title-level lists or discovery.
5. Keep media metadata separate from user state in `UserData`.
6. Preserve typed image roles instead of flattening or losing artwork.
7. Use nullable or omitted type-specific fields rather than inventing different DTOs per media type.

## Canonical DTO

```ts
type BaseItemDto = {
  Id: string;
  Type: 'Movie' | 'Series' | 'Season' | 'Episode' | 'Unknown';

  Name: string;
  OriginalTitle: string | null;
  Overview: string | null;
  Taglines: string[];

  ProductionYear: number | null;
  PremiereDate: string | null;
  CommunityRating: number | null;
  OfficialRating: string | null;
  Certification: string | null;
  Genres: string[];
  RunTimeTicks: number | null;
  Status: string | null;

  ProviderIds: {
    Tmdb: string | null;
    Imdb: string | null;
    Tvdb: string | null;
  };

  ImageTags: BaseItemImageTags;
  ParentImageTags: ParentBaseItemImageTags | null;

  SeriesId: string | null;
  SeriesName: string | null;
  SeasonId: string | null;
  SeasonName: string | null;
  ParentIndexNumber: number | null;
  IndexNumber: number | null;
  AbsoluteIndexNumber: number | null;
  EpisodeTitle: string | null;
  AirDate: string | null;

  RemoteTrailers: RemoteTrailerDto[];

  PosterColor: string | null;
  BackdropColor: string | null;

  UserData: UserItemDataDto | null;
};
```

All properties in the canonical DTO use **PascalCase** to match Jellyfin conventions. Internal adapter types (`MediaItem`) use camelCase.

## Image model

```ts
type ResponsiveImageSet = {
  small: string | null;
  medium: string | null;
  large: string | null;
};

type BaseItemImageTags = {
  Primary: ResponsiveImageSet | null;
  Backdrop: ResponsiveImageSet[];
  Logo: ResponsiveImageSet | null;
  Thumb: ResponsiveImageSet | null;
  Screenshot: ResponsiveImageSet[];
};

type ParentBaseItemImageTags = {
  Primary: ResponsiveImageSet | null;
  Backdrop: ResponsiveImageSet[];
  Logo: ResponsiveImageSet | null;
  Thumb: ResponsiveImageSet | null;
};
```

### Image meaning

| Role | Meaning | Current equivalent |
| --- | --- | --- |
| `Primary` | Main poster or portrait artwork | `images.poster` |
| `Backdrop` | Wide fanart/background artwork | `images.backdrop` |
| `Logo` | Transparent logo/clearlogo | `images.logo` |
| `Thumb` | Item thumbnail; for episodes this is the episode still | `images.still` for episodes |
| `Screenshot` | Additional stills/screenshots | future expansion |
| `ParentImageTags` | Show/season artwork available while rendering an episode | current parent + enriched show artwork |

## User data model

```ts
type UserItemDataDto = {
  ItemId: string;
  IsFavorite: boolean;
  Played: boolean;
  PlayCount: number;
  PlaybackPositionTicks: number | null;
  RuntimeTicks: number | null;
  PlayedPercentage: number | null;
  LastPlayedDate: string | null;
  Rating: number | null;
  DismissedFromContinueWatching: boolean;
};
```

### User data rules

- `PlaybackPositionTicks`, `RuntimeTicks`, `PlayedPercentage`, and `LastPlayedDate` represent resume/progress state.
- `Played`, `PlayCount`, and `LastPlayedDate` represent watched history state.
- `IsFavorite` represents watchlist/favorite membership.
- `Rating` represents the profile's rating.
- `DismissedFromContinueWatching` is user state, not media metadata.

## Query result shape

```ts
type BaseItemDtoQueryResult = {
  Items: BaseItemDto[];
  StartIndex: number;
  TotalRecordCount: number;
  NextCursor: string | null;
  HasMore: boolean;
};
```

## Migration progress

| Step | Status |
| --- | --- |
| Add canonical `BaseItemDto`, image tags, provider ids, `UserItemDataDto` | Done |
| Add `mediaItemToBaseItemDto()`, `watchCacheRecordToBaseItemDto()` mappers | Done |
| Remove legacy `MediaItemDto`, aliases, and camelCase re-exports | Done |
| Rename all `mediaItemDtoSchema` → `baseItemDtoSchema` in contracts | Done |
| Migrate watch surfaces (continue-watching, history, ratings, watchlist, state, calendar) | Done |
| Migrate metadata detail/extras/resolve/playback-resolve | Done |
| Migrate search and suggestions to `BaseItemDto` | Done |
| Migrate recommendations output and profile input signals | Done |
| Migrate AI search response | Done |
| Update OpenAPI YAML to PascalCase response shapes | Done |
| Update guard script | Done |
