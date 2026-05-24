# Client and RECO Pipeline Implementation Plan

Status: target plan for hard-cutover cleanup.

This plan intentionally removes old recommendation layers instead of adding compatibility wrappers.

## Phase 1: Contract source cleanup

1. Make `docs/specs/client-reco-pipeline-spec.md` the active target spec.
2. Retire the BaseItemDto/Jellyfin recommendation spec direction.
3. Update recommendation architecture docs to describe two separate pipelines:
   - client UI cards
   - RECO machine signals/writes
4. Update OpenAPI only when runtime changes land in the same branch.
5. Regenerate OpenAPI TypeScript types after contract changes.

Acceptance:

- No current doc tells recommendation clients to consume `BaseItemDto`.
- No current doc tells RECO to consume `Item: BaseItemDto`.
- No current doc says RECO writes only `{ type, tmdbId }`.

## Phase 2: New TypeScript contract types

Create dedicated types beside existing modules, then replace old uses in-place:

- `src/modules/recommendations/reco-contract.types.ts`
  - `ProviderRef`
  - `RecoItemRef`
  - `RecoSignalBundle`
  - `RecoHistorySignal`
  - `RecoRatingSignal`
  - `RecoWatchlistSignal`
  - `RecoContinueSignal`
  - `RecoWriteItem`
  - `RecoListWriteRequest`
- `src/modules/recommendations/client-home.types.ts`
  - `ClientMediaCard`
  - `ClientHomeSection`
  - `ClientHomeResponse`
  - `ClientImages`
  - `ClientProgress`

Delete or rewrite old recommendation public types that expose `BaseItemDto[]`.

Acceptance:

- Recommendation public types do not import `BaseItemDto`.
- RECO signal/write types do not import `BaseItemDto`.
- Only metadata/watch compatibility surfaces may still use `BaseItemDto` if separately required by their own contracts.

## Phase 3: Provider identity resolver

Replace write-time media-key construction with explicit provider-ref resolution.

Required changes:

1. Stop using `buildCanonicalContentId(type, tmdbId)` for recommendation writes.
2. Add a resolver that accepts:
   - `{ itemId }`
   - `{ ref: { provider, providerId, type } }`
3. Resolve `{ itemId }` by validating public item ID and decoding to content UUID.
4. Resolve provider refs through `ContentIdentityService` / `content_provider_refs`.
5. Fix provider support blockers before allowing TVDB writes:
   - `src/modules/identity/media-key.ts` must not reject non-TMDB providers in code paths used by provider refs, or recommendation writes must avoid media-key parsing entirely.
   - Do not derive `tmdbId` from generic `providerId` when `provider !== 'tmdb'`.
   - Ensure TVDB refs resolve deterministically through provider-ref rows.

Acceptance:

- TMDB, TVDB, IMDb, and Kitsu refs share one validation shape.
- Non-TMDB numeric IDs are never interpreted as TMDB IDs.
- Provider refs are input references, not canonical stored identities.

## Phase 4: Recommendation storage cleanup

Add a forward migration for list metadata and canonical item storage.

Recommended DB changes:

```sql
ALTER TABLE recommendation_list_versions
  ADD COLUMN title text,
  ADD COLUMN subtitle text,
  ADD COLUMN layout text;
```

Then backfill or rewrite rows during the hard cutover.

Target `items_json` shape:

```json
[
  {
    "itemId": "8a1f7c852e864e2a9c0b77d9efc5a901",
    "rank": 1,
    "sourceRef": { "provider": "tmdb", "providerId": "550" },
    "score": 0.98,
    "reason": "Because you watched The Matrix",
    "reasonCodes": ["similar_history"],
    "metadata": {}
  }
]
```

Remove the old meaning of `contentId` as `movie:tmdb:550`.

Acceptance:

- Stored list items have `itemId`.
- Stored list metadata has `title`, `subtitle`, and `layout`.
- Collection layout stores the same item shape as all other layouts.
- No write path stores enriched card blobs as recommendation source data.

## Phase 5: RECO signal pipeline rewrite

Current leak point:

- `ProfileSignalBundleService` forwards `BaseItemDto` from `ProfileInputSignalFacade`.

Replacement:

1. Add a mapper from current internal item/card data to `RecoItemRef`.
2. Populate `providerRefs` from server-side external refs, not client `ProviderIds`.
3. Populate lightweight `features` only.
4. Return `RecoSignalBundle.signals.*[].item`, not `Item`.
5. Remove `baseItemDtoSchema` usage from internal RECO signal schemas.

Acceptance:

- RECO signal endpoint response contains no `BaseItemDto` fields.
- RECO receives provider refs and lightweight features.
- RECO receives interaction semantics, timestamps, progress, and ratings.

## Phase 6: RECO write pipeline rewrite

Current path:

- `ServiceRecommendationItemRef = { type, tmdbId }`
- service validation rejects provider refs, item IDs, score, reason metadata.

Replacement:

1. Change request body to include list metadata:
   - `title`
   - `subtitle`
   - `layout`
   - `items`
   - optional model/context metadata
2. Change item validation to accept `itemId | ref`.
3. Rank by array order.
4. Allow `score`, `reason`, `reasonCodes`, and bounded metadata.
5. Resolve every item to canonical `itemId` before storage.
6. Remove legacy profile-only route `PUT /internal/apps/v1/profiles/:profileId/recommendations`.

Acceptance:

- Preferred account/profile/list route is the only service write route.
- Writes are provider-generic.
- List title/subtitle/layout are persisted.
- Item enrichment is not accepted from RECO.

## Phase 7: Client home pipeline rewrite

Current path:

- `RecommendationOutputService` maps regular/landscape items to `BaseItemDto`.
- Hero already maps closer to a UI card.
- Collection stores baked title/logo/poster fields and lacks item IDs.

Replacement:

1. Add `ClientMediaCard` mapper from `MetadataCardView` plus watch state.
2. Return `ClientHomeResponse` from `/v1/profiles/:profileId/home`.
3. Return all layouts as `ClientHomeSection` with `title` and `subtitle`.
4. Convert collection items to normal `ClientMediaCard` items.
5. Remove public recommendation `BaseItemDto[]` section types.

Acceptance:

- Client home items are camelCase cards.
- Client home cards do not include provider refs.
- Collection cards are navigable by `itemId`.
- No recommendation client response uses PascalCase BaseItemDto fields.

## Phase 8: OpenAPI and schema updates

Update these files in the implementation branch:

- `openapi/public-app.v1.yaml`
  - Replace home recommendation item schema with `ClientMediaCard`.
  - Add `subtitle` to home sections.
  - Remove `BaseItemDto` from `ProfileHomeSection.items`.
- `openapi/internal-services.v1.yaml`
  - Replace signal bundle `BaseItemDto` references with `RecoItemRef`.
  - Replace `RecommendationListWriteItem` with `itemId | ref` identity.
  - Add list `title`, `subtitle`, `layout` to single and batch writes.
- `src/http/contracts/shared.ts`
  - Keep shared public item ID schema.
  - Do not use `baseItemDtoSchema` for RECO contracts.
- `src/http/contracts/internal-apps.ts`
  - Add RECO signal/write schemas.
- `src/http/contracts/recommendations` or equivalent
  - Add client home card schemas.

Acceptance:

- `npm run contract:check` passes after runtime and OpenAPI changes land together.

## Phase 9: Tests

Add or update tests for:

- RECO signal bundle has no `Item`/`BaseItemDto` shape.
- RECO signal item includes `itemId` and provider refs.
- RECO write accepts item ID refs.
- RECO write accepts TVDB refs when provider refs exist.
- RECO write rejects enriched card fields.
- List write persists title/subtitle/layout.
- Stored items use canonical `itemId`.
- Public home cards omit provider refs and `BaseItemDto` fields.
- Collections include item IDs.

Verification commands:

```bash
npm run typecheck
npm test
npm run contract:check
npm run build
```

## Cutover checklist

- Delete old BaseItemDto recommendation docs or replace them with pointers to the new spec.
- Remove old recommendation migration plan language.
- Remove legacy route registration.
- Remove TMDB-only write validator.
- Remove misleading `contentId` naming for provider media keys.
- Regenerate OpenAPI types.
- Run full verification.
