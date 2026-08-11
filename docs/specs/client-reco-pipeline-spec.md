# Client and Home Ingest Pipeline Spec

Status: target contract for the home ingest pipeline and the **single** read-path shape shared by every consumer.

## Goals

- **One card shape for every read path.** Public clients, the reco worker, and the reco webui all read the same `ClientMediaCard[]` envelope. There is no parallel `BaseItemDto` leak on internal signal routes, and no per-consumer enrichment layer.
- **One write shape for every producer.** All home ingest producers (`reco`, `custom`, `fallback`) push through the same `RecoListWriteRequest` body and the same `writeHome` ingester.
- Separate client UI payloads from recommendation-engine machine payloads on the *write* side only.
- Keep public client recommendations UI-ready and provider-free by default.
- Give RECO explicit machine-readable provider refs, interaction signals, list metadata, and scoring metadata on the *write* side.
- Let MAIN own canonicalization, authorization, storage, and metadata enrichment.
- Support future provider refs such as TVDB without changing client app contracts.

## Non-goals

- No enriched poster/title blobs stored as recommendation source data.
- No compatibility endpoint, dual shape, or per-consumer enrichment pass for any read path.
- No legacy `BaseItemDto` shape carried alongside the card shape on internal routes "for backward compatibility." The internal signal routes return cards, not raw `BaseItemDto` rows.

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
- **One read-time enrichment pass.** MAIN materializes `ClientMediaCard` for every read path (public `/v1` watch + home routes, internal `/internal/apps/v1` signal routes). The same card shape is served to the public client app, the reco worker, and the reco webui. No consumer runs its own enrichment pass on top.
- Public recommendation responses must not include `ProviderIds`, `providerRefs`, `tmdbId`, `tvdbId`, `score`, `modelVersion`, `contentId`, `mediaKey`, `UserData`, or PascalCase BaseItemDto fields.

## RECO signal pipeline

RECO receives the same `ClientMediaCard[]` envelope the public client app receives. It does **not** receive raw `BaseItemDto` rows, and it does **not** run its own `CatalogService` or `signal_bundle_mapper` to re-enrich items.

### RECO item ref

RECO's worker reads the card's `itemId` + `mediaType` directly off each `ClientMediaCard`. The provider-ref extraction needed by the generation pipeline (`GenerateRequest`) is performed by a single shared helper that maps `ClientMediaCard → { itemId, mediaType }`; no `RecoItemRef` type is shipped from Crispy Server.

```ts
type RecoItemRef = {
  itemId: string;       // ClientMediaCard.itemId
  mediaType: 'movie' | 'tv'; // ClientMediaCard.mediaType normalized to movie/tv
};
```

Rules:

- The internal signal routes return `ClientMediaCard[]` (one card per row), not raw `BaseItemDto`.
- RECO reads `itemId` and `mediaType` off each card; it does not re-resolve `ProviderIds.Tmdb` because MAIN already canonicalized identity at materialization time.
- RECO must not carry enriched card payloads over to the *write* side. The read-shape card never reaches `RecoListWriteRequest.items`; the write side still uses `RecoWriteItem` (provider refs + `type`), as below.
- RECO must not include titles, original titles, years, release dates, posters, backdrops, logos, trailers, or `BaseItemDto.UserData` in its write payload.

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

All watch signal routes return the **same `ClientMediaCard`** payload the public `/v1/profiles/:profileId/watch/*` routes return — MAIN runs the unified read-time enrichment pass for every route. There is no `BaseItemDtoQueryResult` shape on the wire anywhere downstream of MAIN.

**Enrichment note:** Internal signal routes run the **same** read-time card materialization the public routes do. Items return as fully-enriched `ClientMediaCard` rows — `title`, `overview`, `year`, `images`, `trailerUrl`, `progress`, `parent` are all populated. The reco worker reads `itemId` and `mediaType` directly; the reco webui renders the cards as-is. Neither consumer runs a `CatalogService` pass, looks up TMDB metadata by `ProviderIds.Tmdb`, or overlays display fields on each row.

RECO assembles a local `RecommendationBundle` from these card row results. A single shared `cardToRecoInput` helper extracts each card's `itemId` + `mediaType` into the provider-ref-free tuple `GenerateRequest` expects. (Crispy Server does not ship a separate `RecoItemRef` type or a `signal_bundle_mapper`; the helper is the only mapping step and lives next to the client contract.)

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
    history: ClientMediaCard[];          // rows from /watch/history
    ratings: ClientMediaCard[];          // rows from /watch/ratings
    watchlist: ClientMediaCard[];        // rows from /watch/watchlist
    continueWatching: ClientMediaCard[]; // rows from /watch/continue-watching
    episodicFollow?: ClientMediaCard[];  // rows from /watch/episodic-follow
    taste?: TasteProfileRecord | null;   // from /signals/taste
  };
};
```

`RecoItemRef` is constructed by reco's helper from the `ClientMediaCard` rows (`itemId` + `mediaType`). It still follows the rules below: RECO items on the *write* side are provider-ref + `type`; never `ClientMediaCard` on the write side.

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
  description?: string;
  /** @deprecated open bag; replace with explicit `description` in a future migration */
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
- `score` and `metadata` are **tolerated but ignored** by the home response. They are kept in the OpenAPI schema for backward compatibility only. New producers should omit them.
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
  description?: string;
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
- **Internal signal routes return `ClientMediaCard[]`**, the same card shape the public routes return — not raw `BaseItemDto` rows with display fields null.
- **One read-time enrichment pass.** The same `HomeHydrator`/`MetadataCardService` path that hydrates public `/home` cards also hydrates internal signal route rows. No `WatchMetadataEnrichmentService` exists alongside it.
- **No reco-side enrichment layer.** Reco's worker reads `itemId` + `mediaType` off each card directly; reco's webui renders the cards as-is. There is no `CatalogService`, `signal_bundle_mapper`, or `signal_assembler` step that re-resolves TMDB metadata from `ProviderIds.Tmdb`.
- No `AdminWatchReadService` duplicate of `LocalUserWatchService`; one read service per signal.
- No parallel `parseHomeWriteBody` shape in the public `PUT /v1/.../home` route alongside the `RecoListWriteRequest` contract — one write parser.
- RECO writes `RecoWriteItem`-shaped items to MAIN (provider refs + `type`), never `ClientMediaCard` or `BaseItemDto` on the write side.
- RECO signals (read side) consume `ClientMediaCard[]`; RECO writes use provider refs plus `type`, not Crispy `itemId`.
- MAIN resolves all writes to canonical public item IDs before storage.
- No recommendation storage path writes provider media keys as `contentId`.
- A single `GET /home` response carries sections from exactly one `source`; sources are never concatenated.
- The home store keeps at most N snapshots per `(profile, source)` per the table above; old snapshots are pruned in the write transaction.
- TVDB provider refs can be accepted without changing client contracts.

## Layers to delete (no legacy compatibility retained)

These are removed entirely under the single-card-shape contract. There is no dual-shape fallback and no shrunken-but-kept version of any of them:

| Layer | File / Symbol | Why it goes away |
| --- | --- | --- |
| Dual enrichment pass | `src/modules/watch/watch-metadata-enrichment.service.ts` (`WatchMetadataEnrichmentService`) | Replaced by the single `MetadataCardService`/`HomeHydrator` card path used for both public and internal routes. |
| Duplicate watch read service | `src/modules/integrations/admin-watch-read.service.ts` (`AdminWatchReadService`) | One read service (`LocalUserWatchService`) per signal; the internal route passes `(accountId, profileId)` explicitly. |
| Reco-side re-enrichment | reco `src/app-api/CatalogService` (or equivalent) | Internal signal rows already arrive as `ClientMediaCard`; no TMDB re-resolution needed. |
| Reco-side bundle mapper | reco `src/app-api/signal_bundle_mapper.ts` (and any renamed `signal_assembler`) | Replaced by a single `cardToRecoInput` helper that reads `itemId` + `mediaType` off each card. The `BaseItemDto → ProviderIds.Tmdb + Type + UserData` extraction no longer exists. |
| Duplicate home write parser | `parseHomeWriteBody` in `src/http/routes/recommendation-outputs.ts` | Public `PUT /v1/profiles/:profileId/home` and internal `PUT /internal/apps/v1/.../recommendations/lists/:listKey` share the same `RecoListWriteRequest` parser. |
