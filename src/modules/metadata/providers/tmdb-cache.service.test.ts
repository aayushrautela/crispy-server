import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';
import type { TmdbCacheService } from './tmdb-cache.service.js';

seedTestEnv();

function makeTitle(overrides: Record<string, unknown> = {}) {
  return {
    mediaType: 'tv',
    tmdbId: 42,
    language: 'en',
    name: 'Cached Show',
    originalName: 'Cached Show',
    overview: null,
    tagline: null,
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
    raw: {},
    hydrationLevel: 'detail' as const,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('getTitle returns fresh cached record without any TMDB call', async () => {
  const module = await import('./tmdb-cache.service.js');
  let apiCalls = 0;
  const service = new module.TmdbCacheService(
    { getTitle: async () => makeTitle() } as never,
    {} as never,
    { request: async () => { apiCalls += 1; return {}; } } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42);
  assert.equal(result?.name, 'Cached Show');
  assert.equal(apiCalls, 0);
});

test('getTitle serves stale rows immediately and schedules entity refresh', async () => {
  const module = await import('./tmdb-cache.service.js');

  class SpyStore extends module.TmdbCacheService {
    refreshCalls = 0;
    protected override scheduleEntityRefresh(): void {
      this.refreshCalls += 1;
    }
  }

  const store = new SpyStore(
    { getTitle: async () => makeTitle({ expiresAt: '2000-01-01T00:00:00.000Z' }) } as never,
    { ingestTitle: async () => { throw new Error('stale reads must not block on ingest'); } } as never,
    {} as never,
  );

  const result = await (store as TmdbCacheService).getTitle({} as never, 'tv', 42);
  assert.equal(result?.name, 'Cached Show');
  assert.equal(store.refreshCalls, 1);
});

test('getTitle delegates cold keys to ingest then re-reads', async () => {
  const module = await import('./tmdb-cache.service.js');

  let ingested = false;
  const hydrated = makeTitle();
  const service = new module.TmdbCacheService(
    { getTitle: async () => (ingested ? hydrated : null) } as never,
    {
      ingestTitle: async () => {
        ingested = true;
        return hydrated;
      },
    } as never,
    { request: async () => { throw new Error('store must not use the API client'); } } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42);
  assert.equal(ingested, true);
  assert.equal(result?.name, 'Cached Show');
});

test('getTitle maps negative ingest results to null', async () => {
  const module = await import('./tmdb-cache.service.js');

  const notFoundRow = { ...makeTitle(), hydrationLevel: 'not_found' };
  let reads = 0;
  const service = new module.TmdbCacheService(
    {
      getTitle: async () => {
        reads += 1;
        return reads === 1 ? null : notFoundRow;
      },
    } as never,
    { ingestTitle: async () => null } as never,
    {} as never,
  );

  const result = await service.getTitle({} as never, 'tv', 999);
  assert.equal(result, null);
});

test('getTitle hydrates summary records instead of returning them', async () => {
  const module = await import('./tmdb-cache.service.js');

  let ingested = false;
  const summaryRow = makeTitle({ hydrationLevel: 'summary', expiresAt: '2099-01-01T00:00:00.000Z' });
  const detailRow = makeTitle({ hydrationLevel: 'detail' });
  const service = new module.TmdbCacheService(
    {
      getTitle: async () => (ingested ? detailRow : summaryRow),
    } as never,
    {
      ingestTitle: async () => {
        ingested = true;
        return detailRow;
      },
    } as never,
    { request: async () => { throw new Error('store must not use the API client'); } } as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42);
  assert.equal(ingested, true);
  assert.equal(result?.hydrationLevel, 'detail');
});

test('getTitles hydrates only missing keys', async () => {
  const module = await import('./tmdb-cache.service.js');

  const requested = [
    { mediaType: 'movie' as const, tmdbId: 1 },
    { mediaType: 'movie' as const, tmdbId: 2 },
  ];

  const service = new module.TmdbCacheService(
    {
      getTitles: async () => new Map([['movie:1', makeTitle({ mediaType: 'movie', tmdbId: 1 })]]),
      getTitle: async () => makeTitle({ mediaType: 'movie', tmdbId: 2 }),
    } as never,
    {
      ingestTitle: async (_client: unknown, _mediaType: string, tmdbId: number) => makeTitle({ mediaType: 'movie', tmdbId }),
    } as never,
    {} as never,
  );

  const results = await service.getTitles({} as never, requested, 'en');
  assert.equal(results.get('movie:1')?.name, 'Cached Show');
  assert.equal(results.get('movie:2')?.tmdbId, 2);
});

test('searchTitles stays local when enough hits exist', async () => {
  const module = await import('./tmdb-cache.service.js');

  let apiCalls = 0;
  const localHits = Array.from({ length: 6 }, (_, index) => makeTitle({ tmdbId: index + 1 }));
  const service = new module.TmdbCacheService(
    { searchTitles: async () => localHits } as never,
    {} as never,
    { request: async () => { apiCalls += 1; return {}; } } as never,
  );

  const results = await service.searchTitles({} as never, 'cache', 20, ['movie', 'tv'], 'en');
  assert.equal(results.length, 6);
  assert.equal(apiCalls, 0);
});

test('searchTitles falls back to TMDB when local coverage is thin', async () => {
  const module = await import('./tmdb-cache.service.js');

  let searchCalls = 0;
  let persisted = false;
  const service = new module.TmdbCacheService(
    {
      searchTitles: async () => {
        searchCalls += 1;
        if (!persisted) {
          return [makeTitle()];
        }
        return [makeTitle(), makeTitle({ tmdbId: 7, name: 'Live Hit', mediaType: 'movie' })];
      },
      upsertTranslations: async () => {},
      upsertSummaryTitles: async () => {},
    } as never,
    {
      persistSummaries: async () => {
        persisted = true;
      },
    } as never,
    { request: async () => ({ results: [{ id: 7, title: 'Live Hit', media_type: 'movie' }] }) } as never,
  );

  const results = await service.searchTitles({} as never, 'live', 20, ['movie'], 'en');
  assert.equal(searchCalls, 2);
  assert.equal(results.length, 2);
});

test('ensureSeasonCached ingests expired seasons inline', async () => {
  const module = await import('./tmdb-cache.service.js');

  let ingested = false;
  const season = {
    showTmdbId: 10,
    seasonNumber: 1,
    name: 'S1',
    overview: null,
    airDate: null,
    posterPath: null,
    episodeCount: 8,
    raw: {},
    fetchedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const service = new module.TmdbCacheService(
    {
      getSeason: async () => (ingested ? season : null),
      getSeasonEpisodes: async () => [],
    } as never,
    {
      ingestSeason: async () => {
        ingested = true;
      },
    } as never,
    {} as never,
  );

  const result = await service.ensureSeasonCached({} as never, 10, 1);
  assert.equal(ingested, true);
  assert.equal(result?.name, 'S1');
});

test('getTitle fills missing image kinds on detail records instead of serving them bare', async () => {
  const module = await import('./tmdb-cache.service.js');

  const bare = makeTitle({ logoPath: null });
  const filled = makeTitle({ logoPath: '/logo.png' });
  let reads = 0;
  let fetched: Array<{ mediaType: string; tmdbId: number }> = [];
  const service = new module.TmdbCacheService(
    {
      getTitle: async () => {
        reads += 1;
        return reads === 1 ? bare : filled;
      },
      missingImageKinds: async () => (reads === 1 ? ['logo'] : []),
    } as never,
    {
      fetchImages: async (_client: unknown, mediaType: string, tmdbId: number) => {
        fetched.push({ mediaType, tmdbId });
      },
    } as never,
    {} as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42);
  assert.deepEqual(fetched, [{ mediaType: 'tv', tmdbId: 42 }]);
  assert.equal(result?.logoPath, '/logo.png');
});

test('getTitle serves cached record when image fill fails', async () => {
  const module = await import('./tmdb-cache.service.js');

  const bare = makeTitle({ logoPath: null });
  const service = new module.TmdbCacheService(
    {
      getTitle: async () => bare,
      missingImageKinds: async () => ['logo'],
    } as never,
    {
      fetchImages: async () => {
        throw new Error('tmdb down');
      },
    } as never,
    {} as never,
  );

  const result = await service.getTitle({} as never, 'tv', 42);
  assert.equal(result?.name, 'Cached Show');
});

test('getTitles fills missing image kinds on detail records', async () => {
  const module = await import('./tmdb-cache.service.js');

  const bare = makeTitle({ logoPath: null });
  const filled = makeTitle({ logoPath: '/logo.png' });
  let fetched = 0;
  const service = new module.TmdbCacheService(
    {
      getTitles: async () => new Map([['tv:42', bare]]),
      missingImageKinds: async () => ['logo'],
      getTitle: async () => {
        fetched += 1;
        return filled;
      },
    } as never,
    {
      fetchImages: async () => {},
    } as never,
    {} as never,
  );

  const results = await service.getTitles({} as never, [{ mediaType: 'tv', tmdbId: 42 }], 'en');
  assert.equal(results.get('tv:42')?.logoPath, '/logo.png');
  assert.equal(fetched, 1);
});

test('getEpisodes schedules season warm for missing episodes and dedupes seasons', async () => {
  const module = await import('./tmdb-cache.service.js');

  class SpyStore extends module.TmdbCacheService {
    warmed: Array<{ showTmdbId: number; seasonNumber: number }> = [];
    protected override scheduleSeasonWarm(showTmdbId: number, seasonNumber: number): void {
      this.warmed.push({ showTmdbId, seasonNumber });
    }
  }

  const episode = { showTmdbId: 42, seasonNumber: 1, episodeNumber: 2 };
  const store = new SpyStore(
    {
      getEpisodes: async () => new Map([['42:1:2', episode]]),
    } as never,
    {} as never,
    {} as never,
  );

  const results = await (store as import('./tmdb-cache.service.js').TmdbCacheService).getEpisodes({} as never, [
    { showTmdbId: 42, seasonNumber: 1, episodeNumber: 2 },
    { showTmdbId: 42, seasonNumber: 1, episodeNumber: 3 },
    { showTmdbId: 42, seasonNumber: 2, episodeNumber: 1 },
  ]);
  assert.equal(results.get('42:1:2'), episode);
  assert.equal(results.get('42:1:3'), null);
  assert.deepEqual(store.warmed, [
    { showTmdbId: 42, seasonNumber: 1 },
    { showTmdbId: 42, seasonNumber: 2 },
  ]);
});

test('getSeasons schedules season warm for missing seasons', async () => {
  const module = await import('./tmdb-cache.service.js');

  class SpyStore extends module.TmdbCacheService {
    warmed: Array<{ showTmdbId: number; seasonNumber: number }> = [];
    protected override scheduleSeasonWarm(showTmdbId: number, seasonNumber: number): void {
      this.warmed.push({ showTmdbId, seasonNumber });
    }
  }

  const season = { showTmdbId: 42, seasonNumber: 1 };
  const store = new SpyStore(
    {
      getSeasons: async () => new Map([['42:1', season]]),
    } as never,
    {} as never,
    {} as never,
  );

  const results = await (store as import('./tmdb-cache.service.js').TmdbCacheService).getSeasons({} as never, [
    { showTmdbId: 42, seasonNumber: 1 },
    { showTmdbId: 42, seasonNumber: 2 },
  ]);
  assert.equal(results.get('42:1'), season);
  assert.equal(results.get('42:2'), null);
  assert.deepEqual(store.warmed, [{ showTmdbId: 42, seasonNumber: 2 }]);
});
