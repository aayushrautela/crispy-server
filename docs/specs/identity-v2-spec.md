# Identity v2 Spec

Status: implemented.

## Standard

Crispy public identity is Jellyfin-style opaque item identity.

- `BaseItemDto.Id` is a 32-character lowercase dashless UUID hex string derived from `content_items.id`.
- `SeriesId`, `SeasonId`, and `UserData.ItemId` are the same public item-id format.
- External provider identifiers live in `ProviderIds` and server-side `content_provider_refs`.
- Parent/child relationships live in `content_item_relationships`.
- Clients must treat every item id as opaque and must not parse it for provider, media type, title, season, or episode data.

Example:

```json
{
  "Id": "8a1f7c852e864e2a9c0b77d9efc5a901",
  "Type": "Episode",
  "SeriesId": "7d5fbcfd6e2a46b7a75f55e1ac0030a1",
  "SeasonId": "a40c4cb1037548e19126c1c82aefdfaa",
  "ProviderIds": {
    "Tmdb": "1396"
  },
  "UserData": {
    "ItemId": "8a1f7c852e864e2a9c0b77d9efc5a901"
  }
}
```

## API rules

- Public routes accept `itemId` only for content identity.
- Request and response contracts use `itemId`, `Id`, `SeriesId`, or `SeasonId` for content identity.
- Batch card hydration accepts `itemIds`.
- Watch state, watchlist, ratings, playback, AI insights, metadata cards, profile signal bundle `Item.Id` fields, and recommendation-facing outputs use item IDs.
- Raw provider IDs are never accepted as public content identity.
- Provider-derived route identities are not a compatibility layer.

## Storage rules

- User-state tables store UUID item columns, not public strings.
- Public item IDs are encoded at API boundaries and decoded before DB writes.
- Provider references are lookup metadata, not public identity.
- Relationship resolution must use `content_item_relationships` rather than parsing public IDs.

## Validation

Public item IDs must match:

```text
^[0-9a-f]{32}$
```

Any other shape is invalid for public content identity.
