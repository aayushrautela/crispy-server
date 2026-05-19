# Jellyfin-First Public Media API Spec

## Status

Planned replacement for any SurfaceItem-style API direction.

## Goal

Keep Crispy's public media API as close to Jellyfin as practical:

- Media objects are `BaseItemDto`.
- Media lists use `BaseItemDtoQueryResult`.
- User-specific playback, favorite, played, rating, and progress state lives in `UserData`.
- Search uses Jellyfin-style item query/search-hint shapes.
- Recommendations use Jellyfin-style recommendation groups containing `Items: BaseItemDto[]`.

The API must not introduce a universal `{ mediaItem, context, presentation }` wrapper.

## Non-goals

- Do not create a cross-surface `SurfaceItem` response shape.
- Do not rename media fields to camelCase in public responses.
- Do not move watch state out of `UserData` into endpoint-specific context objects.
- Do not require every endpoint to expose layout/card rendering instructions.
- Do not preserve custom recommendation item wrappers as the long-term public contract.
- Do not provide legacy compatibility aliases, dual response shapes, or migration-window fields for this change.

## Core principles

1. Match Jellyfin DTO names and casing unless Crispy has a clear product reason not to.
2. Keep media identity, metadata, artwork, provider IDs, and user state on `BaseItemDto`.
3. Keep endpoint context at the outer response level, not inside each media item.
4. Use route/query parameters to communicate filters and source, not per-item wrappers.
5. Keep recommendation explanation metadata at the recommendation group level where possible.
6. If a Crispy-only feature must remain, add it as a small explicit extension to the closest Jellyfin-style DTO.

## Canonical media item

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
  ProviderIds: Record<string, string | null>;
  ImageTags: BaseItemImageTags;
  ParentImageTags: ParentBaseItemImageTags | null;
  UserData: UserItemDataDto | null;
};
```

Public media fields stay PascalCase.

## User data

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

Rules:

- Continue watching progress is represented by `PlaybackPositionTicks`, `RuntimeTicks`, and `PlayedPercentage`.
- Watch history is represented by `Played`, `PlayCount`, and `LastPlayedDate`.
- Watchlist/favorite state is represented by `IsFavorite`.
- User rating is represented by `Rating`.

## List response

```ts
type BaseItemDtoQueryResult = {
  Items: BaseItemDto[];
  StartIndex: number;
  TotalRecordCount: number;
  NextCursor?: string | null;
  HasMore?: boolean;
};
```

Use this shape for media-item lists such as:

- continue watching
- watch history
- watchlist
- ratings
- generic item discovery
- suggestions
- next-up style rows

## Search

Crispy can support two Jellyfin-like search paths.

### Full item search

For full media results, return `BaseItemDtoQueryResult` or a response whose media arrays are directly `BaseItemDto[]`.

```ts
type TitleSearchResponse = {
  Query: string;
  Items: BaseItemDto[];
  TotalRecordCount: number;
  StartIndex: number;
};
```

If buckets are kept for product convenience, bucket values must still be raw `BaseItemDto[]`:

```ts
type BucketedTitleSearchResponse = {
  Query: string;
  All: BaseItemDto[];
  Movies: BaseItemDto[];
  Series: BaseItemDto[];
  People: PersonSearchResult[];
};
```

Do not wrap search results as `{ mediaItem, context, presentation }`.

### Search hints

For autocomplete/lightweight search, use a Jellyfin-like search hint result:

```ts
type SearchHintResult = {
  SearchHints: SearchHint[];
  TotalRecordCount: number;
};
```

`SearchHint` is a lightweight result and does not need the full `BaseItemDto` shape. If a hint is selectable, its `Id` should be the canonical public item ID; provider identifiers such as TMDB IDs stay in `ProviderIds`.

## Recommendations

Use Jellyfin's recommendation model as the base shape:

```ts
type RecommendationDto = {
  Items: BaseItemDto[];
  RecommendationType: RecommendationType;
  BaselineItemName: string | null;
  CategoryId: string;
};
```

Allowed Crispy extensions, if the app still needs them:

```ts
type CrispyRecommendationDto = RecommendationDto & {
  Title?: string;
  Layout?: 'regular' | 'landscape' | 'hero' | 'collection';
  Reason?: string | null;
  Rank?: number | null;
};
```

Rules:

- `Items` must be `BaseItemDto[]`.
- Do not use per-item `Item`, `mediaItem`, `context`, or `presentation` wrappers as the long-term contract.
- Recommendation reason text should describe the group, for example "Because you watched Interstellar".
- Ranking should be expressed by array order first. `Rank` is optional metadata for debugging or analytics.
- Layout is optional Crispy UI metadata. If possible, clients should infer card layout from section type or app design instead of depending on server-driven presentation hints.

## Existing Crispy-only fields

| Old concept | User-visible meaning | Jellyfin-first destination |
| --- | --- | --- |
| `context.reason` | Why a row/item was recommended | `RecommendationDto.BaselineItemName`, `RecommendationType`, or optional group `Reason` |
| `context.score` | Hidden ranking confidence | Do not expose publicly unless needed for diagnostics |
| `context.rank` | Ordering | Array order; optional group `Rank` only if needed |
| `presentation.preferredSize` | Card shape/layout | Optional group `Layout`; otherwise client-owned UI |
| `kind/source` per item | Which endpoint produced item | Route/query context, not item payload |

## Migration plan

1. Keep existing `BaseItemDto` and `BaseItemDtoQueryResult` as the canonical media response types.
2. Reject any plan that changes `BaseItemDtoQueryResult.Items` away from `BaseItemDto[]`.
3. Update recommendation public contract directly to `RecommendationDto[]` or `CrispyRecommendationDto[]`.
4. Hard cutoff: remove legacy recommendation item wrappers and aliases in the same change. Do not ship dual response shapes.
5. Move any truly needed recommendation explanation/layout data to the recommendation group level.
6. Keep search and AI search media arrays as raw `BaseItemDto[]` or move to `BaseItemDtoQueryResult`.
7. Remove unused `MobileSurfaceItem`/SurfaceItem-style public schema if no runtime code depends on it.
8. Update OpenAPI/contracts endpoint by endpoint with runtime changes.
9. Add contract tests to assert no public media list returns `{ mediaItem, context, presentation }` wrappers.

## Acceptance criteria

- Public media items are `BaseItemDto`.
- Public media list containers keep `Items: BaseItemDto[]` or direct `BaseItemDto[]` buckets.
- Recommendations expose groups with `Items: BaseItemDto[]`.
- No public contract defines a universal `SurfaceItem` wrapper.
- No endpoint requires the client to unwrap `mediaItem` before accessing `Id`, `Name`, `Type`, `ImageTags`, or `UserData`.
- No legacy compatibility response aliases remain for removed wrapper fields such as `Item`, `mediaItem`, `context`, or `presentation`.
