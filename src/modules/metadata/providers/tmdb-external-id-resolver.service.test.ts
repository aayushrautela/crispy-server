import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

test('TmdbExternalIdResolverService returns null for empty external id', async () => {
  const { TmdbExternalIdResolverService } = await import('./tmdb-external-id-resolver.service.js');

  const service = new TmdbExternalIdResolverService(
    {} as never,
    { findByExternalId: async () => null } as never,
  );

  const result = await service.resolve({} as never, { source: 'imdb_id', externalId: '  ', mediaType: 'movie' });
  assert.equal(result, null);
});

test('TmdbExternalIdResolverService returns cached tmdb id', async () => {
  const { TmdbExternalIdResolverService } = await import('./tmdb-external-id-resolver.service.js');

  const service = new TmdbExternalIdResolverService(
    {} as never,
    { findByExternalId: async () => ({ tmdbId: 42, notFoundAt: null }) } as never,
  );

  const result = await service.resolve({} as never, { source: 'imdb_id', externalId: 'tt1234567', mediaType: 'movie' });
  assert.equal(result, 42);
});

test('TmdbExternalIdResolverService fetches from TMDB when not cached', async () => {
  const { TmdbExternalIdResolverService } = await import('./tmdb-external-id-resolver.service.js');

  let upsertedTmdbId: number | null = null;
  const service = new TmdbExternalIdResolverService(
    { request: async () => ({ movie_results: [{ id: 99 }] }) } as never,
    {
      findByExternalId: async () => null,
      upsertExternalId: async (_client: unknown, params: { tmdbId: number }) => { upsertedTmdbId = params.tmdbId; },
    } as never,
  );

  const result = await service.resolve({} as never, { source: 'imdb_id', externalId: 'tt1234567', mediaType: 'movie' });
  assert.equal(result, 99);
  assert.equal(upsertedTmdbId, 99);
});

test('TmdbExternalIdResolverService returns null when TMDB has no match', async () => {
  const { TmdbExternalIdResolverService } = await import('./tmdb-external-id-resolver.service.js');

  let markedNegative = false;
  const service = new TmdbExternalIdResolverService(
    { request: async () => ({ movie_results: [], tv_results: [] }) } as never,
    {
      findByExternalId: async () => null,
      markExternalIdNotFound: async () => { markedNegative = true; },
    } as never,
  );

  const result = await service.resolve({} as never, { source: 'imdb_id', externalId: 'tt0000000', mediaType: 'movie' });
  assert.equal(result, null);
  assert.equal(markedNegative, true);
});
