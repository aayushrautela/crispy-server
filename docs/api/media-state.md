# Client media state guide

This guide summarizes client-facing media identity and watch-state rules. Exact endpoint parameters and payload schemas are owned by `openapi/public-app.v1.yaml`; if this guide and OpenAPI differ, update the guide or contract rather than treating this file as a schema source.

## Canonical public identity

`mediaKey` is the canonical public navigation and watch-domain identity. Clients should use `mediaKey` for:

- title navigation
- playback resolution
- watch-state lookup
- watchlist mutations
- rating mutations
- recommendation item navigation when a payload is navigable

Supporting identity fields are compatibility or convenience fields:

- `type` is derived from `mediaKey` and should not be treated as a separate identity source.
- `provider` and `providerId` on canonical media shapes are deprecated compatibility fields and may be removed from client-facing payloads.
- `contentId` is a legacy alias accepted during migration only; new clients should use `mediaKey`.

## Media types and provider model

Canonical media identity is TMDB-backed. Public title/card flows primarily expose movies, shows, and episodes; metadata internals may also use season and person identities where documented in OpenAPI.

There is no first-class backend `anime` media type. Anime-origin titles are modeled as normal TMDB movies or shows.

Provider connection endpoints still refer to Trakt and Simkl as import providers. That is separate from canonical metadata identity, which remains TMDB-backed.

## Search and metadata

Search and metadata routes resolve TMDB-backed identities:

- Search buckets are `movies`, `series`, and `all`.
- There is no `anime` search bucket.
- Metadata resolve/detail/playback routes should be called with `mediaKey` or the identity fields documented in OpenAPI.
- Clients should not construct provider-routed identities from deprecated `provider`/`providerId` fields when `mediaKey` is available.
- Primary card/list surfaces should expose canonical `BaseItemDto` presentation fields from the server: `Name`, `ImageTags.Primary`, `ImageTags.Backdrop`, `ImageTags.Logo`, `ImageTags.Thumb`, `CommunityRating`, `ProductionYear`, and nullable `OfficialRating`.
- Image fields are responsive sets with `small`, `medium`, and `large` nullable URLs. Scalar legacy fields such as `posterUrl`, `backdropUrl`, `logoUrl`, and `stillUrl` are not returned.
- `ImageTags.Logo` is nullable and sparse because TMDB does not provide logos for every title; clients should fall back to text titles.

## Watch state

Watch-state routes are `mediaKey`-based and express product intent rather than storage details:

- Single-item state lookup receives one media identity.
- Batch state lookup receives a bounded list of media identities.
- Watchlist and rating mutations should target the canonical media key path value documented in OpenAPI.
- Playback progress updates incomplete resume state.
- Completed playback records a chronological history event and removes active resume state for that title.
- Manual mark watched records watched state and removes active resume state.
- Manual unwatch records a new watched-state event that can make effective watched state false.
- Full watch history returns chronological watched events and preserves rewatches.
- Media-specific history can be requested for a movie, episode, or show media key.
- Show state includes `watchedEpisodeKeys` derived from watched episode summaries.

Continue-watching items represent active resume state only.

- **`Id`** is the title-level key (`movie:tmdb:X` or `show:tmdb:X`). Use this when calling the dismiss endpoint.
- **`Id`** is the playable unit: `movie:tmdb:X` for movies, `episode:tmdb:showId:season:episode` for episode progress (also serves as `mediaKey`).
- **`SeriesName`** and **`SeriesId`** are populated for episodes. Clients should use `SeriesId` for show-level navigation from episode items.
- **`ParentIndexNumber`** is the season number, **`IndexNumber`** is the episode number.
- **`EpisodeTitle`** is the episode name (also available in `Name`).

Clients should not infer watched status from continue-watching rows. Watched badges, episode ticks, and show watched state come from server watch-state responses.

## Recommendations

Recommendation read payloads should follow canonical media identity rules:

- Use `mediaKey` where a recommendation item is navigable.
- Treat `type` as derived convenience data.
- Primary card/list surfaces should expose canonical `BaseItemDto` presentation fields from the server: `Name`, `ImageTags.Primary`, `ImageTags.Backdrop`, `ImageTags.Logo`, `ImageTags.Thumb`, `CommunityRating`, `ProductionYear`, and nullable `OfficialRating`.
- Image fields are responsive sets with `small`, `medium`, and `large` nullable URLs. Scalar legacy fields such as `posterUrl`, `backdropUrl`, `logoUrl`, and `stillUrl` are not returned.
- `ImageTags.Logo` is nullable and sparse because TMDB does not provide logos for every title; clients should fall back to text titles.
- Do not depend on deprecated `provider`/`providerId` fields for navigation.

Recommendation write payloads for service-owned lists use ordered TMDB references as documented in OpenAPI and `docs/api/recommendations.md`; writers should not submit enriched card metadata or legacy identity aliases.
