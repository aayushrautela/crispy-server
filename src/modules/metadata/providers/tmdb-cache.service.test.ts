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
    hydrationLevel: 'detail',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('getTitle returns cached detail record when fresh and level matches', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  let refreshCalls = 0;
  const service = new TmdbCacheService(
    {
      getTitle: async () => makeTitle(),
      upsertTitle: async () => {},
    } as never,
    {
      fetchTitleDetail: async () => {
        refreshCalls += 1;
        return { name: 'Refreshed Show' };
      },
      fetchTitleSummary: async () => {
        refreshCalls += 1;
        return { name: 'Refreshed Show' };
      },
      fetchExternalIds: async () => ({}),
    } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42, 'detail');
  assert.equal(refreshCalls, 0);
  assert.equal(result?.name, 'Cached Show');
});

test('getTitle upgrades summary cache to detail', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  let refreshCalls = 0;
  const service = new TmdbCacheService(
    {
      getTitle: async () => makeTitle({ hydrationLevel: 'summary' }),
      upsertTitle: async () => {},
    } as never,
    {
      fetchTitleDetail: async () => {
        refreshCalls += 1;
        return { name: 'Upgraded Show', genres: [{ id: 18, name: 'Drama' }] };
      },
      fetchTitleSummary: async () => {
        refreshCalls += 1;
        return { name: 'Upgraded Show' };
      },
      fetchExternalIds: async () => ({}),
    } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42, 'detail');
  assert.equal(refreshCalls, 1);
  assert.equal(result?.name, 'Upgraded Show');
  assert.equal(result?.hydrationLevel, 'detail');
});

test('getTitle uses summary level when requested', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  let refreshCalls = 0;
  const service = new TmdbCacheService(
    {
      getTitle: async () => makeTitle({ hydrationLevel: 'summary' }),
      upsertTitle: async () => {},
    } as never,
    {
      fetchTitleDetail: async () => {
        refreshCalls += 1;
        return { name: 'Detail' };
      },
      fetchTitleSummary: async () => {
        refreshCalls += 1;
        return { name: 'Summary' };
      },
      fetchExternalIds: async () => ({}),
    } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42, 'summary');
  assert.equal(refreshCalls, 0);
  assert.equal(result?.name, 'Cached Show');
  assert.equal(result?.hydrationLevel, 'summary');
});

test('getTitle fetches from API when not cached', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  let refreshCalls = 0;
  const service = new TmdbCacheService(
    {
      getTitle: async () => null,
      upsertTitle: async () => {},
    } as never,
    {
      fetchTitleDetail: async () => {
        refreshCalls += 1;
        return { name: 'Fresh Show', genres: [{ id: 18, name: 'Drama' }] };
      },
      fetchTitleSummary: async () => {
        refreshCalls += 1;
        return { name: 'Fresh Show' };
      },
      fetchExternalIds: async () => ({}),
    } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42, 'detail');
  assert.equal(refreshCalls, 1);
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
      fetchTitleDetail: async () => { throw new HttpError(404, 'not found'); },
      fetchTitleSummary: async () => { throw new HttpError(404, 'not found'); },
      fetchExternalIds: async () => ({}),
    } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 999, 'detail');
  assert.equal(result, null);
});
