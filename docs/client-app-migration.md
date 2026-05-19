# Client App Migration: Jellyfin-First Public Media API (Hard Cutoff)

## Status

Done on server side. Client must migrate now — no backward compatibility layer will be shipped.

## What Changed

Recommendation item responses are now raw `BaseItemDto` objects. The `RecommendationSectionItem` wrapper (`Item`, `context`, `presentation`, `reason`, `score`, `rank`, `payload`) has been removed across all recommendation endpoints.

### Old shape (removed)

```json
{
  "kind": "recommendation",
  "Item": { "Id": "...", "Name": "...", ... },
  "context": { "reason": "...", "score": 0.9, "rank": 1, "payload": {} },
  "presentation": { "preferredSize": "poster", "sectionId": null, "sectionTitle": null }
}
```

### New shape

```json
{
  "Id": "movie:tmdb:550",
  "Type": "Movie",
  "Name": "Fight Club",
  "ImageTags": { "Primary": { "small": "..." }, ... },
  "CommunityRating": 8.8,
  "ProductionYear": 1999,
  "UserData": null
  ...
}
```

### Sections structure

Sections now hold `BaseItemDto[]` directly:

```json
{
  "id": "rec_1",
  "title": "Because you watched The Matrix",
  "layout": "regular",
  "items": [ /* BaseItemDto[] */ ],
  "meta": {}
}
```

## Client Changes Required

1. **Remove wrapper unwrapping**: Access `Id`, `Name`, `Type`, `ImageTags` directly on items — stop accessing `item.Item.Id` or `item.mediaItem`.
2. **Remove per-item context/presentation**: Reason and score per item are gone. If you need recommendation reason text, it should be at the section title level.
3. **Remove dual-layer types**: Delete any client-side `RecommendationSectionItem`, `SurfaceItem`, `MobileSurfaceItem`, `MediaPresentationHint` types. Standardize on `BaseItemDto` everywhere.
4. **Remove MobileSurfaceKind references**: If the client has `kind`-based rendering switches, replace with the `layout` field at the section level (`regular`, `landscape`, `hero`, `collection`).

## Hard Cutoff Rules

- The server will **never** include `Item`, `context`, `presentation`, `reason`, `score`, `rank`, or `payload` fields in public recommendation items.
- There is no migration window, no dual response shape, no feature flag. This is a hard break.
- The `BaseItemDto` shape is the only item shape for public media lists (continue-watching, history, watchlist, ratings, search results, home recommendations).

## Reference

- Jellyfin-first spec: `docs/specs/jellyfin-style-unified-item-dto.md`
- API behavior: `docs/api/recommendations.md`
- Server commit: `2b25c90` — "refactor: remove SurfaceItem wrappers and use BaseItemDto in recommendations"
