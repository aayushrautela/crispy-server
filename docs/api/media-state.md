# Client media state guide

This guide summarizes client-facing media identity and watch-state rules. Exact endpoint parameters and payload schemas are owned by `openapi/public-app.v1.yaml`; if this guide and OpenAPI differ, update the guide or contract rather than treating this file as a schema source.

## Canonical public identity

`itemId` is the only canonical public navigation and watch-domain identity. It is a 32-character lowercase dashless UUID hex string from `content_items.id`.

Clients should use `itemId` for:

- title navigation
- playback resolution
- watch-state lookup
- watchlist mutations
- rating mutations
- recommendation item navigation when a payload is navigable

Clients must treat item IDs as opaque. Do not parse them, derive provider IDs from them, or construct them from TMDB/Trakt/TVDB values.

Supporting identity fields are convenience fields only:

- `Type` / `mediaType` are derived presentation fields and are not identity sources.
- Provider refs are internal/RECO data unless an endpoint explicitly documents them for diagnostics/export.
- `SeriesId`, `SeasonId`, and item-specific parent fields are also public item IDs where exposed.

## Media types and provider model

Canonical public item IDs are provider-independent. TMDB, TVDB, IMDb, Trakt, and other provider references are stored as external refs and may appear only in provider/reference fields documented in OpenAPI.

There is no first-class backend `anime` media type. Anime-origin titles are modeled as normal movies or shows.

Provider connection endpoints still refer to Trakt and Simkl as import providers. That is separate from canonical public identity.

## Search and metadata

Search and metadata routes use item IDs:

- Search buckets are `movies`, `series`, and `all`.
- There is no `anime` search bucket.
- Metadata resolve/detail/playback routes should be called with `itemId` or `/items/{itemId}` paths documented in OpenAPI.
- Clients should not construct provider-routed identities from provider fields.
- Card/list surfaces expose server-enriched presentation fields from the server.
- Image fields are responsive sets with `small`, `medium`, and `large` nullable URLs.
- Logo artwork is nullable and sparse; clients should fall back to text titles.

## Watch state

Watch-state routes are item-ID based and express product intent rather than storage details:

- Single-item state lookup receives one `itemId`.
- Batch state lookup receives a bounded list of `itemId` values.
- Watchlist and rating mutations target the item ID path value documented in OpenAPI.
- Playback progress updates incomplete resume state.
- Completed playback records a chronological history event and removes active resume state for that title.
- Manual mark watched records watched state and removes active resume state.
- Manual unwatch records a new watched-state event that can make effective watched state false.
- Full watch history returns chronological watched events and preserves rewatches.
- Media-specific history can be requested for a movie, episode, or show item ID.
- Show state includes watched episode item IDs derived from watched episode summaries.

Continue-watching items represent active resume state only.

- For movies, the item ID is the movie item ID.
- For episode progress, the item ID is the episode item ID and the parent show item ID is exposed where documented.
- Series title, season number, and episode number are presentation fields.

Clients should not infer watched status from continue-watching rows. Watched badges, episode ticks, and show watched state come from server watch-state responses.

## Recommendations

Recommendation read payloads follow canonical item ID identity rules and the target client/RECO split:

- Public recommendation cards use `itemId` for navigation.
- Public recommendation cards expose UI-ready display fields, artwork, and progress.
- Public recommendation cards do not expose provider refs, RECO score/reason metadata, storage `contentId`, or media keys.
- Public recommendation sections include `title`, `subtitle`, `sectionType`, and ordered items.
- RECO write payloads use provider refs plus media type as documented in `docs/api/recommendations.md` and `docs/specs/client-reco-pipeline-spec.md`; they do not use public `itemId`.
