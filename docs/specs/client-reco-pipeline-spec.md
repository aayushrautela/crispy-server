# Client and RECO Pipeline Spec

Status: target contract for the recommendation/client cleanup.

This spec replaces the BaseItemDto-first recommendation direction. Do not add dual response shapes, migration aliases, compatibility wrappers, or legacy profile-only routes for this change.

## Goals

- Separate client UI payloads from recommendation-engine machine payloads.
- Keep public client recommendations UI-ready and provider-free by default.
- Give RECO explicit machine-readable identity, provider refs, interaction signals, list metadata, and scoring metadata.
- Let MAIN own canonicalization, authorization, storage, and metadata enrichment.
- Support future provider refs such as TVDB without changing client app contracts.

## Non-goals

- No `BaseItemDto` in public recommendation home sections.
- No `BaseItemDto` in RECO signal bundles.
- No TMDB-only recommendation write contract.
- No collection items without `itemId`.
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

type ClientHomeSection = {
  listKey: string;
  title: string;
  subtitle: string | null;
  layout: 'regular' | 'landscape' | 'hero' | 'collection';
  items: ClientMediaCard[];
  meta: Record<string, unknown>;
};
```

Rules:

- `title` is required for every list/section.
- `subtitle` is optional but must be present as `null` when absent.
- Item order is display order.
- Every item in every layout, including collections, must have `itemId`.
- Client cards are enriched by MAIN at read time.
- Public recommendation responses must not include `ProviderIds`, `providerRefs`, `tmdbId`, `tvdbId`, `score`, `reasonCodes`, `modelVersion`, `contentId`, `mediaKey`, `UserData`, or PascalCase BaseItemDto fields.

## RECO signal pipeline

RECO receives machine DTOs. It does not receive UI DTOs.

### RECO item ref

```ts
type RecoItemRef = {
  itemId: PublicItemId;
  type: 'movie' | 'tv' | 'season' | 'episode';
  providerRefs: ProviderRef[];
  features: RecoItemFeatures;
};

type RecoItemFeatures = {
  title: string;
  originalTitle: string | null;
  year: number | null;
  releaseDate: string | null;
  genres: string[];
  runtimeSeconds: number | null;
  maturityRating: string | null;
  language: string | null;
  country: string | null;
  popularity: number | null;
};
```

Rules:

- `itemId` is required when MAIN knows the item.
- `providerRefs` may contain TMDB, TVDB, IMDb, Kitsu, or future refs supported by MAIN.
- RECO must not infer canonical identity from provider priority. MAIN owns canonicalization.
- RECO signals must not include posters, backdrops, logos, trailers, client watch DTOs, or `BaseItemDto.UserData`.

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

RECO writes list metadata plus ordered item refs. MAIN resolves identities, stores canonical item IDs, applies policy, and enriches client responses later.

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
  layout: 'regular' | 'landscape' | 'hero' | 'collection';
  items: RecoWriteItem[];
  model: RecoModelInfo | null;
  context: Record<string, unknown>;
};

type RecoWriteItem = {
  item: RecoWriteItemIdentity;
  score: number | null;
  reason: string | null;
  reasonCodes: string[];
  metadata: Record<string, unknown>;
};

type RecoWriteItemIdentity =
  | { itemId: PublicItemId }
  | { ref: ProviderRef & { type: 'movie' | 'tv' | 'season' | 'episode' } };

type RecoModelInfo = {
  runId: string | null;
  algorithmVersion: string;
  modelVersion: string | null;
};
```

Rules:

- `title` is required.
- `subtitle` is nullable, not omitted.
- `layout` is required.
- Rank is derived from array order.
- `item.itemId` is preferred when RECO writes known catalog items from MAIN signals.
- `item.ref` is allowed for provider-derived candidates. MAIN resolves it to canonical item identity.
- `score`, `reason`, and `reasonCodes` are stored for diagnostics/explainability but are not exposed to normal client UI by default.
- RECO must not send posters, artwork, descriptions, display titles per item, `contentId`, `mediaKey`, TMDB-specific top-level fields, or enriched card payloads.

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
      layout: 'regular' | 'landscape' | 'hero' | 'collection';
      items: RecoWriteItem[];
      model: RecoModelInfo | null;
      context: Record<string, unknown>;
    }>;
  }>;
};
```

## Storage target

Recommendation list versions store list metadata separately from item identity.

```ts
type StoredRecommendationListVersion = {
  accountId: string;
  profileId: string;
  source: string;
  listKey: string;
  version: number;
  title: string;
  subtitle: string | null;
  layout: 'regular' | 'landscape' | 'hero' | 'collection';
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
- Collections use the same item storage as every other layout.
- Client response assembly enriches `itemId` through MAIN metadata/card services.

## Hard-cutover rules

- Remove old BaseItemDto recommendation contracts in the same implementation branch.
- Remove the legacy profile-only internal recommendation write route.
- Remove TMDB-only `{ type, tmdbId }` write validation.
- Remove docs/specs that instruct clients to standardize on `BaseItemDto`.
- Do not ship feature flags, alternate response envelopes, or temporary compatibility aliases.

## Acceptance criteria

- Public home recommendations contain `ClientHomeSection[]` and `ClientMediaCard[]` only.
- Public home recommendations contain `title` and `subtitle` for each section.
- RECO signal bundle item fields are `RecoItemRef`, never `BaseItemDto`.
- RECO write accepts `itemId` or generic `ProviderRef`, not only `tmdbId`.
- MAIN resolves all writes to canonical public item IDs before storage.
- No recommendation storage path writes provider media keys as `contentId`.
- TVDB provider refs can be accepted without changing client contracts.
