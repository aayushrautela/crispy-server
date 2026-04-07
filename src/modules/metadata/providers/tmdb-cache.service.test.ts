import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

test('TmdbCacheService refreshes legacy cached titles that only include similar payloads', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  let refreshCalls = 0;
  const service = new TmdbCacheService(
    {
      getTitle: async () => ({
        mediaType: 'tv',
        tmdbId: 42,
        name: 'Legacy Show',
        originalName: 'Legacy Show',
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
        raw: { similar: { results: [] } },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
      upsertTitle: async () => {},
    } as never,
    {
      fetchTitle: async () => {
        refreshCalls += 1;
        return {
          name: 'Refreshed Show',
          original_name: 'Refreshed Show',
          first_air_date: '2024-01-01',
          recommendations: { results: [] },
        };
      },
      fetchExternalIds: async () => ({}),
    } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42);
  assert.equal(refreshCalls, 1);
  assert.equal(result?.name, 'Refreshed Show');
  assert.deepEqual(result?.raw.recommendations, { results: [] });
});

test('TmdbCacheService does not return legacy similar-only cache when refresh fails', async () => {
  const { TmdbCacheService } = await import('./tmdb-cache.service.js');

  const service = new TmdbCacheService(
    {
      getTitle: async () => ({
        mediaType: 'tv',
        tmdbId: 42,
        name: 'Legacy Show',
        originalName: 'Legacy Show',
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
        raw: { similar: { results: [] } },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
      upsertTitle: async () => {},
    } as never,
    {
      fetchTitle: async () => {
        throw new Error('refresh failed');
      },
      fetchExternalIds: async () => ({}),
    } as never,
  );

  await assert.rejects(() => service.getTitle({} as never, 'tv', 42), /refresh failed/);
});
