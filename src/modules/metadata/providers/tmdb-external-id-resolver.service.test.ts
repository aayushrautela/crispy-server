import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

test('TmdbExternalIdResolverService returns null for empty external id', async () => {
  const { TmdbExternalIdResolverService } = await import('./tmdb-external-id-resolver.service.js');

  const service = new TmdbExternalIdResolverService(
    { findByExternalId: async () => null } as never,
    {} as never,
  );

  const result = await service.resolve({} as never, { source: 'imdb_id', externalId: '  ', mediaType: 'movie' });
  assert.equal(result, null);
});

test('TmdbExternalIdResolverService returns cached tmdb id', async () => {
  const { TmdbExternalIdResolverService } = await import('./tmdb-external-id-resolver.service.js');

  const service = new TmdbExternalIdResolverService(
    { findByExternalId: async () => ({ tmdbId: 42 }) } as never,
    {} as never,
  );

  const result = await service.resolve({} as never, { source: 'imdb_id', externalId: 'tt1234567', mediaType: 'movie' });
  assert.equal(result, 42);
});

test('TmdbExternalIdResolverService fetches from TMDB when not cached', async () => {
  const { TmdbExternalIdResolverService } = await import('./tmdb-external-id-resolver.service.js');

  let upsertedTmdbId: number | null = null;
  const service = new TmdbExternalIdResolverService(
    {
      findByExternalId: async () => null,
      upsert: async (_client: unknown, params: { tmdbId: number }) => { upsertedTmdbId = params.tmdbId; },
    } as never,
    { request: async () => ({ movie_results: [{ id: 99 }] }) } as never,
    {
      getOrFetch: async (_client: unknown, _spec: unknown, _policyKey: unknown, fetchFn: () => Promise<Record<string, unknown>>) => ({
        cacheKey: 'test',
        resourceType: 'external_id',
        resourceId: 'imdb_id:tt1234567',
        variant: 'movie',
        language: null,
        requestPath: '/find/tt1234567',
        requestQuery: {},
        responseJson: await fetchFn(),
        statusCode: 200,
        isNegative: false,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        freshUntil: '2099-01-01T00:00:00.000Z',
        staleUntil: '2099-01-01T00:00:00.000Z',
        purgeAt: '2099-01-01T00:00:00.000Z',
        lastError: null,
        errorCount: 0,
      }),
    } as never,
  );

  const result = await service.resolve({} as never, { source: 'imdb_id', externalId: 'tt1234567', mediaType: 'movie' });
  assert.equal(result, 99);
  assert.equal(upsertedTmdbId, 99);
});

test('TmdbExternalIdResolverService returns null when TMDB has no match', async () => {
  const { TmdbExternalIdResolverService } = await import('./tmdb-external-id-resolver.service.js');

  const service = new TmdbExternalIdResolverService(
    { findByExternalId: async () => null } as never,
    { request: async () => ({ movie_results: [], tv_results: [] }) } as never,
    {
      getOrFetch: async (_client: unknown, _spec: unknown, _policyKey: unknown, fetchFn: () => Promise<Record<string, unknown>>) => ({
        cacheKey: 'test',
        resourceType: 'external_id',
        resourceId: 'imdb_id:tt0000000',
        variant: 'movie',
        language: null,
        requestPath: '/find/tt0000000',
        requestQuery: {},
        responseJson: await fetchFn(),
        statusCode: 200,
        isNegative: false,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        freshUntil: '2099-01-01T00:00:00.000Z',
        staleUntil: '2099-01-01T00:00:00.000Z',
        purgeAt: '2099-01-01T00:00:00.000Z',
        lastError: null,
        errorCount: 0,
      }),
    } as never,
  );

  const result = await service.resolve({} as never, { source: 'imdb_id', externalId: 'tt0000000', mediaType: 'movie' });
  assert.equal(result, null);
});
