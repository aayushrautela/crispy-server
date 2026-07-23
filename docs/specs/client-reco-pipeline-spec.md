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

### RECO signal bundle

```ts
type RecoSignalBundle = {
  accountId: string;
  profileId: string;
  purpose: 'recommendation-generation';
  generatedAt: string;
  signalsVersion: number;
  eligibility: {
    eligible: boolean;
    eligibilityVersion: number;
  };
  profile: {
    displayName: string;
    isKids: boolean;
    language: string | null;
    region: string | null;
    maturityRating: string | null;
  };
  signals: {
    history: RecoHistorySignal[];
    ratings: RecoRatingSignal[];
    watchlist: RecoWatchlistSignal[];
    continueWatching: RecoContinueSignal[];
    negative: RecoNegativeSignal[];
    impressions: RecoImpressionSignal[];
  };
  limits: Record<string, number>;
};

type RecoHistorySignal = {
  item: RecoItemRef;
  watchedAt: string;
  progressPercent: number;
  completionState: 'completed' | 'partial' | 'unknown';
  durationSeconds: number | null;
};

type RecoRatingSignal = {
  item: RecoItemRef;
  rating: number;
  ratedAt: string;
  ratingSource: string | null;
};

type RecoWatchlistSignal = {
  item: RecoItemRef;
  addedAt: string;
};

type RecoContinueSignal = {
  item: RecoItemRef;
  progressPercent: number;
  updatedAt: string;
};

type RecoNegativeSignal = {
  item: RecoItemRef;
  reason: string;
  createdAt: string;
};

type RecoImpressionSignal = {
  item: RecoItemRef;
  listKey: string;
  shownAt: string;
};
```

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
- RECO signal bundle item fields are `RecoItemRef`, never `BaseItemDto`.
- RECO signals and writes use provider refs plus `type`, not Crispy `itemId`.
- MAIN resolves all writes to canonical public item IDs before storage.
- No recommendation storage path writes provider media keys as `contentId`.
- A single `GET /home` response carries sections from exactly one `source`; sources are never concatenated.
- The home store keeps at most N snapshots per `(profile, source)` per the table above; old snapshots are pruned in the write transaction.
- TVDB provider refs can be accepted without changing client contracts.
