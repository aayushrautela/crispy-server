# Provider Metadata Cache Plan

## Goal

Build proper persisted cache layers for `TVDB` and `Kitsu`, aligned with the existing `TMDB` cache architecture, then move provider-backed detail reads onto those caches before layering the metadata behavior updates on top.

Primary providers remain:
- `movie -> tmdb`
- `show -> tvdb`
- `anime -> kitsu`

TMDB remains an enrichment source for provider-backed titles when a TMDB mapping exists.

## Decisions

- Cache full normalized provider bundles, not small per-section fragments.
- Keep TMDB enrichment separate from provider cache ownership.
- No cache backfill or migration work is needed.
- Cold cache is acceptable; new tables can warm on demand.
- Keep current enrichments like rating, certification, poster, backdrop, and logo.
- `production`: prefer TMDB, fall back to provider data.
- `similar`: source from TMDB.
- `collection`: use TMDB for movies, Kitsu `mediaRelationships` for anime, `null` for TVDB shows.
- Kitsu cast should come from `characters?include=character,voices.person`.
- Kitsu review author data should come from included `users`, not review `source`.

## Current State

- `TMDB` already has:
  - persisted cache tables
  - repository layer
  - cache service
  - refresh flow
- `TVDB` and `Kitsu` currently:
  - have TTL config in `src/config/app-config.ts`
  - do not have equivalent persisted cache tables/repos/services
  - are loaded live in `src/modules/metadata/provider-metadata.service.ts`

## Phases

### Phase 1: Cache Schema

- [ ] Add a migration for `tvdb_*` cache tables.
- [ ] Add a migration for `kitsu_*` cache tables.
- [ ] Include `fetched_at` and `expires_at` on all cache tables.
- [ ] Add `expires_at` indexes.
- [ ] Add season and episode tables where needed for structured cached reads.

Target files:
- `migrations/<new_provider_cache_migration>.sql`

### Phase 2: Provider Cache Types

- [ ] Add TVDB cache record types.
- [ ] Add Kitsu cache record types.
- [ ] Include normalized fields, `raw`, `extras`, `fetchedAt`, and `expiresAt`.

Target files:
- `src/modules/metadata/providers/provider-cache.types.ts`
or
- `src/modules/metadata/providers/tvdb.types.ts`
- `src/modules/metadata/providers/kitsu.types.ts`

### Phase 3: Repository Layer

- [ ] Add `tvdb.repo.ts`.
- [ ] Add `kitsu.repo.ts`.
- [ ] Implement title upsert/get operations.
- [ ] Implement season replace/get operations.
- [ ] Implement episode replace/get operations.
- [ ] Add bundle reconstruction helpers if they simplify service code.

Target files:
- `src/modules/metadata/providers/tvdb.repo.ts`
- `src/modules/metadata/providers/kitsu.repo.ts`

### Phase 4: Normalization Helpers

- [ ] Extract TVDB normalization logic from `ProviderMetadataService`.
- [ ] Extract Kitsu normalization logic from `ProviderMetadataService`.
- [ ] Ensure normalization can be used both for refresh writes and cached reads.

Target files:
- `src/modules/metadata/providers/tvdb-normalizers.ts`
- `src/modules/metadata/providers/kitsu-normalizers.ts`

### Phase 5: Read-Through Cache Services

- [ ] Add `tvdb-cache.service.ts`.
- [ ] Add `kitsu-cache.service.ts`.
- [ ] Implement read-through cache behavior.
- [ ] Implement stale cache fallback on upstream failure.
- [ ] Move provider bundle fetch logic into cache services.
- [ ] Move TVDB episode fallback logic into TVDB cache service.
- [ ] Move Kitsu multi-endpoint fetch logic into Kitsu cache service.

Target files:
- `src/modules/metadata/providers/tvdb-cache.service.ts`
- `src/modules/metadata/providers/kitsu-cache.service.ts`

### Phase 6: Provider Service Refactor

- [ ] Refactor `ProviderMetadataService` to use provider caches instead of live bundle assembly.
- [ ] Remove direct TVDB bundle fetch path from the detail flow.
- [ ] Remove direct Kitsu bundle fetch path from the detail flow.
- [ ] Keep output shapes unchanged during cache adoption.

Target files:
- `src/modules/metadata/provider-metadata.service.ts`

### Phase 7: Refresh Integration

- [ ] Add `tvdb-refresh.service.ts`.
- [ ] Add `kitsu-refresh.service.ts`.
- [ ] Refresh provider caches explicitly for tracked provider-backed titles.
- [ ] Update tracked metadata state from cached provider next-episode data.
- [ ] Update `MetadataRefreshService` to route provider identities through provider refresh services.

Target files:
- `src/modules/metadata/providers/tvdb-refresh.service.ts`
- `src/modules/metadata/providers/kitsu-refresh.service.ts`
- `src/modules/metadata/metadata-refresh.service.ts`

### Phase 8: TMDB Enrichment Expansion

- [ ] Generalize TMDB fallback lookup to Kitsu as well as TVDB.
- [ ] Keep current TMDB image/rating/certification enrichment behavior.
- [ ] Keep TMDB enrichment separate from provider cache ownership.

Target files:
- `src/modules/metadata/provider-metadata.service.ts`
- `src/modules/metadata/providers/tmdb-external-id-resolver.service.ts`

### Phase 9: Metadata Behavior Changes

- [ ] Update provider production to prefer TMDB and fall back to provider data.
- [ ] Update provider similar to use TMDB as the source.
- [ ] Keep movie collection behavior on TMDB as-is.
- [ ] Add anime collection from cached Kitsu `mediaRelationships.destination`.
- [ ] Keep TVDB collection as `null`.
- [ ] Fix Kitsu cast parsing from cached `characters` payload.
- [ ] Fix Kitsu review author parsing from included `users`.

Target files:
- `src/modules/metadata/provider-metadata.service.ts`
- `src/modules/metadata/metadata-detail-core.service.ts`
- `src/modules/metadata/providers/kitsu.client.ts`
- `src/modules/metadata/providers/tmdb.client.ts`

### Phase 10: Tests

- [ ] Add repository tests for TVDB cache persistence.
- [ ] Add repository tests for Kitsu cache persistence.
- [ ] Add cache-service tests for hit/miss/stale/fallback behavior.
- [ ] Update provider metadata tests for cache-backed reads.
- [ ] Add tests for TMDB-first production.
- [ ] Add tests for TMDB-backed similar.
- [ ] Add tests for Kitsu relationship-based collection.
- [ ] Add tests for Kitsu cast parsing.
- [ ] Add tests for Kitsu review author parsing.
- [ ] Update refresh flow tests for provider-backed cache refresh.

Target files:
- `src/modules/metadata/provider-metadata.service.test.ts`
- `src/modules/metadata/metadata-detail.service.test.ts`
- `src/modules/metadata/providers/*.test.ts`
- `src/modules/metadata/metadata-refresh.service.test.ts`

## Recommended Execution Order

1. Schema
2. Provider cache types
3. Repositories
4. Normalizers
5. Cache services
6. Provider service refactor
7. Refresh services and wiring
8. TMDB enrichment expansion
9. Metadata behavior changes
10. Tests

## Notes

- Do not spend time on backfilling old cache data.
- Do not add compatibility code for legacy provider cache rows.
- Prefer small, testable slices while preserving response shape parity.
- Land cache foundation first, then feature behavior changes on top.
