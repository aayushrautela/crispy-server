import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';
import { HttpError } from '../../../lib/errors.js';

seedTestEnv();

function makeTitle(overrides: Record<string, unknown> = {}) {
  return {
    mediaType: 'tv',
    tmdbId: 42,
    name: 'Cached Show',
    originalName: 'Cached Show',
    overview: null,
    releaseDate: null,
    firstAirDate: '2024-01-01',
    status: null,
    posterPath: null,
    backdropPath: null,
    runtime: null,
    episodeRunTime: [],
    numberOfSeasons: 1,
    numberOfEpisodes: 10,
    externalIds: {},
    raw: { recommendations: { results: [] } },
    hydrationLevel: 'detail' as const,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('getTitle returns cached detail record when fresh and level matches', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  const service = new TmdbCacheService(
    {
      getTitle: async () => makeTitle(),
      upsertTitle: async () => {},
    } as never,
    {
      request: async () => ({ name: 'Fresh Show' }),
    } as never,
    {
      getOrFetch: async () => ({
        cacheKey: 'test',
        resourceType: 'title',
        resourceId: 'tv:42',
        variant: 'detail',
        language: null,
        requestPath: '/tv/42',
        requestQuery: {},
        responseJson: { name: 'Cached Show' },
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

  const result = await service.getTitle({} as never, 'tv', 42);
  assert.equal(result?.name, 'Cached Show');
});

test('getTitle refreshes stale derived title from response cache', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  let upserted: ReturnType<typeof makeTitle> | null = null;
  const service = new TmdbCacheService(
    {
      getTitle: async () => makeTitle({ expiresAt: '2000-01-01T00:00:00.000Z' }),
      upsertTitle: async (_client: unknown, record: ReturnType<typeof makeTitle>) => { upserted = record; },
    } as never,
    {
      request: async () => ({ name: 'Should Not Fetch Directly' }),
    } as never,
    {
      getOrFetch: async () => ({
        cacheKey: 'test',
        resourceType: 'title',
        resourceId: 'tv:42',
        variant: 'detail',
        language: null,
        requestPath: '/tv/42',
        requestQuery: {},
        responseJson: { name: 'Upgraded Show', genres: [{ id: 18, name: 'Drama' }] },
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

  const result = await service.getTitle({} as never, 'tv', 42);
  assert.equal(result?.name, 'Upgraded Show');
  assert.equal((upserted as ReturnType<typeof makeTitle> | null)?.name, 'Upgraded Show');
});

test('getTitle fetches from API when not cached', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  let requestCalls = 0;
  const service = new TmdbCacheService(
    {
      getTitle: async () => null,
      upsertTitle: async () => {},
    } as never,
    {
      request: async () => {
        requestCalls += 1;
        return { name: 'Fresh Show', genres: [{ id: 18, name: 'Drama' }] };
      },
    } as never,
    {
      getOrFetch: async (_client: unknown, spec: unknown, _policyKey: unknown, fetchFn: () => Promise<Record<string, unknown>>) => ({
        cacheKey: 'test',
        resourceType: 'title',
        resourceId: 'tv:42',
        variant: 'detail',
        language: null,
        requestPath: '/tv/42',
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

  const result = await service.getTitle({} as never, 'tv', 42);
  assert.equal(requestCalls, 1);
  assert.equal(result?.name, 'Fresh Show');
});

test('getTitle returns null on 404 from API', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  const service = new TmdbCacheService(
    {
      getTitle: async () => null,
      upsertTitle: async () => {},
    } as never,
    {
      request: async () => { throw new HttpError(404, 'not found'); },
    } as never,
    {
      getOrFetch: async (_client: unknown, _spec: unknown, _policyKey: unknown, fetchFn: () => Promise<Record<string, unknown>>) => {
        try {
          await fetchFn();
        } catch (error) {
          if (error instanceof HttpError && error.statusCode === 404) {
            return {
              cacheKey: 'test',
              resourceType: 'title',
              resourceId: 'tv:999',
              variant: 'detail',
              language: null,
              requestPath: '/tv/999',
              requestQuery: {},
              responseJson: {},
              statusCode: 404,
              isNegative: true,
              fetchedAt: '2026-01-01T00:00:00.000Z',
              freshUntil: '2099-01-01T00:00:00.000Z',
              staleUntil: '2099-01-01T00:00:00.000Z',
              purgeAt: '2099-01-01T00:00:00.000Z',
              lastError: error.message,
              errorCount: 1,
            };
          }
          throw error;
        }
        throw new Error('expected 404');
      },
    } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 999);
  assert.equal(result, null);
});
