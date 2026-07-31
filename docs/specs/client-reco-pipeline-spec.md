# Client and Home Ingest Pipeline Spec

Status: target contract for the home ingest pipeline and the client home response shape.

## Goals

- Separate client UI payloads from recommendation-engine machine payloads.
- Keep public client recommendations UI-ready and provider-free by default.
- Give RECO explicit machine-readable provider refs, interaction signals, list metadata, and scoring metadata.
- Let MAIN own canonicalization, authorization, storage, and metadata enrichment.
- Support future provider refs such as TVDB without changing client app contracts.

## Non-goals

- No enriched poster/title blobs stored as recommendation source data.
- No compatibility endpoint or dual shape for old recommendation contracts.

## Identity rules

### Public item identity

```ts
type PublicItemId = string; // /^[0-9a-f]{32}$/
```

Clients receive public item IDs only. They must treat IDs as opaque.

### Provider refs

```ts
type Provider = 'tmdb' | 'tvdb' | 'imdb' | 'kitsu';

type ProviderRef = {
  provider: Provider;
  providerId: string;
};
```

Provider refs are for internal/RECO contracts only. Public client cards must not expose provider refs unless a specific endpoint is explicitly designed for diagnostics/export.

## Client recommendation pipeline

Client endpoints return UI cards. They do not return provider IDs, RECO model fields, internal storage fields, or `BaseItemDto`.

### Client image shape

```ts
type ImageSet = {
  small: string | null;
  medium: string | null;
  large: string | null;
};

type ClientImages = {
  poster: ImageSet | null;
  backdrop: ImageSet | null;
  logo: ImageSet | null;
  still?: ImageSet | null;
};
```

### Client media card

```ts
type ClientMediaCard = {
  itemId: PublicItemId;
  mediaType: 'movie' | 'tv' | 'season' | 'episode';
  title: string;
  subtitle: string | null;
  overview: string | null;
  year: number | null;
  releaseDate: string | null;
  rating: number | null;
  maturityRating: string | null;
  genres: string[];
  runtimeSeconds: number | null;
  images: ClientImages;
  trailerUrl: string | null;
  progress: ClientProgress | null;
  parent: ClientParentRef | null;
};

type ClientProgress = {
  played: boolean;
  playCount: number;
  positionSeconds: number | null;
  durationSeconds: number | null;
  percent: number | null;
  lastPlayedAt: string | null;
  watchlisted: boolean;
  userRating: number | null;
};

type ClientParentRef = {
  seriesItemId?: PublicItemId;
  seriesTitle?: string;
  seasonItemId?: PublicItemId;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};
```

### Client home response

```ts
type ClientHomeResponse = {
  profileId: string;
  generatedAt: string;
  expiresAt: string | null;
  sections: ClientHomeSection[];
};

type HomeSectionType = 'categoryTabs' | 'heroCarousel' | 'contentRail' | 'collectionRail';

type ClientHomeSection = {
  listKey: string;
  title: string;
  subtitle: string | null;
  sectionType: HomeSectionType;
  items: ClientMediaCard[];
  meta: Record<string, unknown>;
};
```

Rules:

- `title` is required for every list/section.
- `subtitle` is optional but must be present as `null` when absent.
- Item order is display order.
- Every section has a semantic `sectionType`: `categoryTabs`, `heroCarousel`, `contentRail`, or `collectionRail`.
- `categoryTabs` represents top category/tab pills that route to named lists.
- `heroCarousel` represents the large featured carousel.
- `contentRail` represents standard horizontal content rails.
- `collectionRail` represents curated collection/folder rails.
- Client cards are enriched by MAIN at read time.
- Public recommendation responses must not include `ProviderIds`, `providerRefs`, `tmdbId`, `tvdbId`, `score`, `reasonCodes`, `modelVersion`, `contentId`, `mediaKey`, `UserData`, or PascalCase BaseItemDto fields.

## RECO signal pipeline

RECO receives machine DTOs. It does not receive UI DTOs.

### RECO item ref

```ts
type RecoItemRef = {
  type: 'movie' | 'tv';
  providerRefs: ProviderRef[];
};
```

Rules:

- RECO item identity is provider refs plus `type`.
- `providerRefs` may contain TMDB, TVDB, IMDb, Kitsu, or future refs supported by MAIN.
- RECO must not infer Crispy canonical identity from provider priority. MAIN owns canonicalization.
- RECO signals must not include Crispy `itemId`, titles, original titles, years, release dates, posters, backdrops, logos, trailers, client watch DTOs, or `BaseItemDto.UserData`.

### RECO signal pipeline (per-signal reads)

Per the [per-signal refactor](per-signal-refactor-plan.md), MAIN no longer exposes
a single bundle endpoint. RECO fetches individual signals in parallel via:

- `GET /internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/watch/history`
- `GET .../signals/watch/ratings`
- `GET .../signals/watch/watchlist`
- `GET .../signals/watch/continue-watching`
- `GET .../signals/watch/episodic-follow`
- `GET .../signals/profile-meta` — returns `{ profileName, isKids, language, region, watchDataOrigin }` for `GenerateRequest.profileContext` assembly
- `GET .../signals/taste` (reco reads a previously stored taste record)
- `PUT .../signals/taste` (reco pushes refreshed taste back, sharing the same `taste_profiles` table as the public list route)
- `GET .../eligibility` — eligibility decision before reco proceeds

All watch signal routes return the same `BaseItemDtoQueryResult` envelope used by the
public `/v1/profiles/:profileId/watch/*` routes (a `PaginatedWatchCollection<BaseItemDto>`).

**Enrichment note:** Internal signal routes do **not** run the `WatchMetadataEnrichmentService`
pass that the public watch routes do. Items return with display fields (`Name`, `Overview`,
`ProductionYear`, `Genres`, `ImageTags`, etc.) as null. The reco worker does not need these
fields — it reads only `ProviderIds.Tmdb`, `Type`, and `UserData`. The reco webui (a
display-facing consumer) enriches items on its own read path via its `CatalogService`,
looking up TMDB metadata by `ProviderIds.Tmdb` and overlaying `title`, `posterUrl`,
`overview`, `mediaType`, `year` on each row before returning to the browser.

RECO assembles a local `RecommendationBundle` from these results and feeds it to its
`signal_bundle_mapper`. The mapper extracts each row's `ProviderIds.Tmdb`, `Type`
(`'Series'` → `'tv'`, `'Movie'` → `'movie'`), and `UserData` fields (`LastPlayedDate`,
`PlayedPercentage`, `Played`, `Rating`, `PlayCount`) into `RecoItemRef`-shaped inputs
for `GenerateRequest`.

```ts
// Local bundle reco assembles after the per-signal reads (no longer on the wire).
type RecoSignalBundle = {
  accountId: string;
  profileId: string;
  purpose?: 'recommendation-generation';
  eligibility: {
    eligible: boolean;
    eligibilityVersion?: number;
    reason?: string;
  };
  bundle: {
    profileContext: {
      profileName: string;
      isKids: boolean;
      watchDataOrigin: string;
      language?: string;
      region?: string;
    };
    history: BaseItemDto[];          // rows from /watch/history
    ratings: BaseItemDto[];          // rows from /watch/ratings
    watchlist: BaseItemDto[];         // rows from /watch/watchlist
    continueWatching: BaseItemDto[]; // rows from /watch/continue-watching
    episodicFollow?: BaseItemDto[];  // rows from /watch/episodic-follow
    taste?: TasteProfileRecord | null; // from /signals/taste
  };
};
```

`RecoItemRef` is reconstructed by reco's mapper from the BaseItemDto rows (`Type` +
`ProviderIds.Tmdb`). It still follows the rules below: RECO items are provider-ref +
`type`; never `BaseItemDto` on the *write* side.

## RECO write pipeline

RECO writes list metadata plus ordered provider refs. MAIN resolves identities, stores canonical item IDs, applies policy, and enriches client responses later.

### Pipeline producers (target)

This write contract is the **unified home ingest contract** — not just for RECO.
The same endpoint and the same `RecoListWriteRequest` shape are reused by every
producer that materializes a user's home:

| Producer | Where | `source` field | Auth |
| --- | --- | --- | --- |
| RECO (personalized recommendations) | external reco engine, push | `'reco'` (or documented source key) | service principal (`x-service-id` + bearer hash) |
| Custom (curated lists from external service) | external custom service, push | `'custom'` (TBD exact value) | service principal, allow-listed service-id |
| Fallback | internal HTTP source, pulled on miss/failure | `'fallback'` | service principal, internal-only |

Sources do not branch the transform or the write path. They only:

- populate the `source` field on the stored snapshot (for diagnostics, mode resolution, and admin UI);
- drive the auth allow-list on the ingest endpoint.

See `docs/architecture/recommendation-engine.md` → "Home ingest pipeline" for the
end-to-end flow including the eager fallback-pull triggers.

### Single-list write

Path:

```text
PUT /internal/apps/v1/accounts/{accountId}/profiles/{profileId}/recommendations/lists/{listKey}
```

Body:

```ts
type RecoListWriteRequest = {
  title: string;
  subtitle: string | null;
  sectionType: HomeSectionType;
  items: RecoWriteItem[];
  model: RecoModelInfo | null;
  context: Record<string, unknown>;
};

type RecoWriteItem = {
  type: 'movie' | 'tv';
  providerRefs: ProviderRef[];
  /** @deprecated tolerated but ignored; rank is array order */
  score: number | null;
  /** @deprecated renamed to `subtitle` (per-item card subtitle override); keep inline for now */
  reason: string | null;
  /** @deprecated tolerated but ignored; no downstream consumer in home response */
  reasonCodes: string[];
  /** @deprecated open bag; replace with explicit `subtitle`/`description` in a future migration */
  metadata: Record<string, unknown>;
};

type RecoModelInfo = {
  runId: string | null;
  algorithmVersion: string;
  modelVersion: string | null;
};
```

Rules:

- `PUT /internal/apps/v1/accounts/{accountId}/profiles/{profileId}/recommendations/lists/{listKey}` is the production write contract. There is no service-list discovery preflight.
- **Atomic whole-snapshot writes.** The ingester never updates a single rail; a write soft-deletes every existing active row for `(profile, source)` and inserts the new rails in one transaction. A producer that wants to change one rail must resend **all** rails of the snapshot. Failed writes leave the previous snapshot intact.
- Producers must not submit a rail with zero items. The ingester hard-rejects the whole snapshot with `400 INVALID_ITEMS` if any rail is empty. Producers are responsible for guaranteeing "every rail I submit is non-empty" before calling.
- Single-source resolution: a `GET /home` response carries rails from exactly one `source`. Sources are never concatenated.
- Allowed section types: `categoryTabs` (max 100), `heroCarousel` (max 10), `contentRail` (max 100), `collectionRail` (max 100).
- MAIN rejects unknown list keys, mismatched `sectionType`, too many items, ineligible profiles, bad provider refs, duplicate items, and idempotency conflicts with stable canonical errors.
- `Idempotency-Key` is required; reusing it with the same payload replays, reusing it with a different payload returns conflict.
- `title` is required; `subtitle` is nullable, not omitted.
- `sectionType` is required and must be one of `categoryTabs`, `heroCarousel`, `contentRail`, or `collectionRail`.
- Rank is derived from array order; do not send `rank`.
- Every item must have `type` and at least one provider ref.
- RECO must not send `itemId`, `contentId`, `mediaKey`, nested `item`/`ref` wrappers, or TMDB-specific top-level fields.
- `score`, `reason`, `reasonCodes`, and `metadata` are **tolerated but ignored** by the home response. They are kept in the OpenAPI schema for backward compatibility only. New producers should omit them.
- RECO must not send posters, artwork, descriptions, display titles per item, or enriched card payloads.

### Batch write

```ts
type RecoBatchWriteRequest = {
  profiles: Array<{
    accountId: string;
    profileId: string;
    lists: Array<{
      listKey: string;
      title: string;
      subtitle: string | null;
      sectionType: HomeSectionType;
      items: RecoWriteItem[];
      model: RecoModelInfo | null;
      context: Record<string, unknown>;
    }>;
  }>;
};
```

## Storage target

Recommendation list versions store list metadata separately from item identity. All home ingest producers (reco, custom, fallback) share this storage target; `source` distinguishes provenance for diagnostics, mode resolution (`homeMode`), and admin visibility.

```ts
type StoredRecommendationListVersion = {
  accountId: string;
  profileId: string;
  source: string;
  listKey: string;
  version: number;
  title: string;
  subtitle: string | null;
  sectionType: HomeSectionType;
  items: StoredRecommendationItem[];
};

type StoredRecommendationItem = {
  itemId: PublicItemId;
  rank: number;
  sourceRef: ProviderRef | null;
  score: number | null;
  reason: string | null;
  reasonCodes: string[];
  metadata: Record<string, unknown>;
};
```

Rules:

- Stored items use canonical `itemId`, not `movie:tmdb:550` under a `contentId` field.
- `sourceRef` is audit/debug input provenance, not canonical identity.
- `collectionRail` currently uses the same provider-ref content-item write storage as every other section type.
- Client response assembly enriches `itemId` through MAIN metadata/card services.

## Storage retention

The store keeps a bounded number of snapshots per `(profile, source)`. A
snapshot is identified by a `run_id` UUID shared by every rail inserted in a
single atomic write — all rails written in one `writeHome` call share the
same `run_id`.

| Source | Snapshots kept |
| --- | --- |
| `custom` | current + 1 previous |
| `reco` | current + 1 previous |
| `fallback` | current only |

Snapshots older than the keep-set are pruned inside the write transaction
(after the new rails are inserted and activated). The read path only ever
serves the current active snapshot; the "previous" snapshot exists purely as
an automatic rollback surface when a later write fails (its transaction
rolls back, the previous snapshot's active pointers remain intact).

For `fallback`, older snapshots are pruned immediately because fallback is
deterministic — re-running the seed produces an equivalent list, so stale
snapshots carry no rollback value worth the storage cost.

## Hard-cutover rules (completed)

The following legacy paths have been removed. Do not reintroduce them:

- Legacy home `layout` field and legacy `regular`/`landscape`/`hero`/`collection` values.
- Legacy profile-only internal recommendation write route.
- TMDB-only `{ type, tmdbId }` write validation.
- External/RECO `itemId` write and signal identities.
- Docs/specs that instruct clients to standardize on `BaseItemDto`.
- Feature flags, alternate response envelopes, or temporary compatibility aliases.

## Acceptance criteria

- Public home recommendations contain `ClientHomeSection[]` and `ClientMediaCard[]` only.
- Public home recommendations contain `title` and `subtitle` for each section.
- Public home cards may carry a `trailerUrl` resolved by MAIN at read time from TMDB.
- RECO writes `RecoItemRef` to MAIN, never `BaseItemDto`. (On the *read* side, MAIN returns `BaseItemDto` rows for each watch signal; reco's signal_bundle_mapper extracts the `Tmdb` providerId and `Type` to construct `RecoItemRef` for its internal `GenerateRequest`.)
- RECO signals and writes use provider refs plus `type`, not Crispy `itemId`.
- MAIN resolves all writes to canonical public item IDs before storage.
- No recommendation storage path writes provider media keys as `contentId`.
- A single `GET /home` response carries sections from exactly one `source`; sources are never concatenated.
- The home store keeps at most N snapshots per `(profile, source)` per the table above; old snapshots are pruned in the write transaction.
- TVDB provider refs can be accepted without changing client contracts.
