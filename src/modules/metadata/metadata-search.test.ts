import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';

seedTestEnv();

test('searchTitles returns empty when query is blank', async () => {
  const pkg = await import('../search/title-search.service.js');
    const svc = new pkg.TitleSearchService(
      { searchTitles: async () => [], discoverTitlesByGenre: async () => [], searchPeople: async () => [], getTitles: async () => new Map() } as never,
    { ensureContentIds: async () => new Map(), ensureContentId: async () => null } as never,
  );

  const response = await svc.searchTitles({ query: '   ', limit: 10 });
  assert.deepEqual(response, { query: '', movies: [], series: [], people: [] });
});

test('search filter maps series to TMDB tv search types', async () => {
  const pkg = await import('../search/title-search.service.js');

  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('series'), ['tv']);
  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('movies'), ['movie']);
  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('all'), ['movie', 'tv']);
});

test('all filter combines movie and series TMDB results', async () => {
  const { db } = await import('../../lib/db.js');
  const originalConnect = db.connect.bind(db);
  db.connect = async () => ({
    release() {
      return undefined;
    },
  }) as never;

  try {
    const tmdbCalls: Array<{ query: string; limit: number; mediaTypes: string[]; locale?: string | null }> = [];
    const ensuredMediaKeys: string[] = [];
    const pkg = await import('../search/title-search.service.js');

    const movieRecord = createTmdbMovieRecord({
      tmdbId: 101,
      name: 'Alpha Movie',
      releaseDate: '2020-01-01',
    });
    const seriesRecord = createTmdbShowRecord({
      tmdbId: 201,
      name: 'Alpha Series',
      firstAirDate: '2024-01-01',
    });

    const svc = new pkg.TitleSearchService(
      {
        searchTitles: async (_client: unknown, query: string, limit: number, mediaTypes: string[], locale?: string | null) => {
          tmdbCalls.push({ query, limit, mediaTypes, locale });
          return [movieRecord, seriesRecord];
        },
        discoverTitlesByGenre: async () => [],
        searchPeople: async () => [],
        getTitles: async (_client: unknown, requests: Array<{ mediaType: string; tmdbId: number }>) => {
          const map = new Map<string, TmdbTitleRecord | null>();
          for (const req of requests) {
            if (req.tmdbId === movieRecord.tmdbId) map.set(`${req.mediaType}:${req.tmdbId}`, hydrateSearchRecord(movieRecord));
            if (req.tmdbId === seriesRecord.tmdbId) map.set(`${req.mediaType}:${req.tmdbId}`, hydrateSearchRecord(seriesRecord));
          }
          return map;
        },
      } as never,
      {
        ensureContentIds: async (_client: unknown, identities: Array<{ mediaKey: string }>) => {
          ensuredMediaKeys.push(...identities.map((identity) => identity.mediaKey));
          return new Map(identities.map((identity, index) => [identity.mediaKey, `00000000-0000-0000-0000-${String(index + 101).padStart(12, '0')}`]));
        },
        ensureContentId: async () => null,
      } as never,
    );

    const response = await svc.searchTitles({ query: 'Alpha', filter: 'all', limit: 2, locale: 'en-US' });

    assert.deepEqual(tmdbCalls, [{ query: 'Alpha', limit: 2, mediaTypes: ['movie', 'tv'], locale: 'en-US' }]);
    assert.deepEqual(response.movies.map((item) => item.Name), ['Alpha Movie']);
    assert.deepEqual(response.series.map((item) => item.Name), ['Alpha Series']);
    assert.deepEqual(ensuredMediaKeys, ['movie:tmdb:101', 'show:tmdb:201']);
  } finally {
    db.connect = originalConnect;
  }
});

test('searchTitles drops results without posters', async () => {
  const { db } = await import('../../lib/db.js');
  const originalConnect = db.connect.bind(db);
  db.connect = async () => ({
    release() {
      return undefined;
    },
  }) as never;

  try {
    const pkg = await import('../search/title-search.service.js');
    const posterMovie = createTmdbMovieRecord({ tmdbId: 41, name: 'Poster Movie', posterPath: '/poster.jpg' });
    const hiddenSeries = createTmdbShowRecord({ tmdbId: 42, name: 'Hidden Series', posterPath: null });
    const visibleSeries = createTmdbShowRecord({ tmdbId: 43, name: 'Visible Series', posterPath: '/series.jpg', firstAirDate: '2022-01-01' });
    const allRecords = [posterMovie, hiddenSeries, visibleSeries];
    const svc = new pkg.TitleSearchService(
      {
        searchTitles: async () => allRecords,
        discoverTitlesByGenre: async () => [],
        searchPeople: async () => [],
        getTitles: async (_client: unknown, requests: Array<{ mediaType: string; tmdbId: number }>) => {
          const map = new Map<string, TmdbTitleRecord | null>();
          for (const req of requests) {
            const match = allRecords.find((r) => r.tmdbId === req.tmdbId);
            if (match) map.set(`${req.mediaType}:${req.tmdbId}`, hydrateSearchRecord(match));
          }
          return map;
        },
      } as never,
      {
        ensureContentIds: async (_client: unknown, identities: Array<{ mediaKey: string }>) => {
          return new Map(identities.map((identity, index) => [identity.mediaKey, `00000000-0000-0000-0000-${String(index + 101).padStart(12, '0')}`]));
        },
        ensureContentId: async () => null,
      } as never,
    );

    const response = await svc.searchTitles({ query: 'Visible', filter: 'all', limit: 20 });

    assert.deepEqual(response.series.map((item) => item.Name), ['Visible Series']);
  } finally {
    db.connect = originalConnect;
  }
});

test('searchTitles moves noisy series results to the end without disturbing clean order', async () => {
  const { db } = await import('../../lib/db.js');
  const originalConnect = db.connect.bind(db);
  db.connect = async () => ({
    release() {
      return undefined;
    },
  }) as never;

  try {
    const pkg = await import('../search/title-search.service.js');
    const naruto = createTmdbShowRecord({ tmdbId: 201, name: 'Naruto', firstAirDate: '2002-10-03', overview: 'Ninja', raw: { vote_average: 8.4 } });
    const narutoLost = createTmdbShowRecord({ tmdbId: 202, name: 'Naruto Lost', firstAirDate: null, overview: null, raw: { vote_average: null } });
    const narutoNext = createTmdbShowRecord({ tmdbId: 203, name: 'Naruto Next', firstAirDate: '2017-04-05', overview: 'Ninja sequel', raw: { vote_average: 7.9 } });
    const narutoRecords = [naruto, narutoLost, narutoNext];
    const svc = new pkg.TitleSearchService(
      {
        searchTitles: async () => narutoRecords,
        discoverTitlesByGenre: async () => [],
        searchPeople: async () => [],
        getTitles: async (_client: unknown, requests: Array<{ mediaType: string; tmdbId: number }>) => {
          const map = new Map<string, TmdbTitleRecord | null>();
          for (const req of requests) {
            const match = narutoRecords.find((r) => r.tmdbId === req.tmdbId);
            if (match) map.set(`${req.mediaType}:${req.tmdbId}`, hydrateSearchRecord(match));
          }
          return map;
        },
      } as never,
      {
        ensureContentIds: async (_client: unknown, identities: Array<{ mediaKey: string }>) => {
          return new Map(identities.map((identity, index) => [identity.mediaKey, `00000000-0000-0000-0000-${String(index + 101).padStart(12, '0')}`]));
        },
        ensureContentId: async () => null,
      } as never,
    );

    const response = await svc.searchTitles({ query: 'Naruto', filter: 'series', limit: 20 });

    assert.deepEqual(response.series.map((item) => item.Name), ['Naruto', 'Naruto Next', 'Naruto Lost']);
  } finally {
    db.connect = originalConnect;
  }
});

test('searchTitles coalesces identical in-flight requests', async () => {
  const { db } = await import('../../lib/db.js');
  const originalConnect = db.connect.bind(db);
  db.connect = async () => ({
    release() {
      return undefined;
    },
  }) as never;

  try {
    const pkg = await import('../search/title-search.service.js');
    let tmdbCalls = 0;
    let resolveTmdb!: (value: TmdbTitleRecord[]) => void;
    const tmdbPromise = new Promise<TmdbTitleRecord[]>((resolve) => {
      resolveTmdb = resolve;
    });

    const alphaMovie = createTmdbMovieRecord({ tmdbId: 77, name: 'Alpha Movie', releaseDate: '2024-01-01', posterPath: '/alpha.jpg' });

    const svc = new pkg.TitleSearchService(
      {
        searchTitles: async () => {
          tmdbCalls += 1;
          return tmdbPromise;
        },
        discoverTitlesByGenre: async () => [],
        searchPeople: async () => [],
        getTitles: async () => {
          const map = new Map<string, TmdbTitleRecord | null>();
          map.set('movie:77', hydrateSearchRecord(alphaMovie));
          return map;
        },
      } as never,
      {
        ensureContentIds: async (_client: unknown, identities: Array<{ mediaKey: string }>) => {
          return new Map(identities.map((identity, index) => [identity.mediaKey, `00000000-0000-0000-0000-${String(index + 101).padStart(12, '0')}`]));
        },
        ensureContentId: async () => null,
      } as never,
    );

    const first = svc.searchTitles({ query: 'Alpha', filter: 'all', limit: 20, locale: 'en-US' });
    const second = svc.searchTitles({ query: 'Alpha', filter: 'all', limit: 20, locale: 'en-US' });

    await Promise.resolve();
    assert.equal(tmdbCalls, 1);

    resolveTmdb([alphaMovie]);

    const [left, right] = await Promise.all([first, second]);
    assert.deepEqual(left, right);
    assert.equal(tmdbCalls, 1);
  } finally {
    db.connect = originalConnect;
  }
});

test('suggestTitles returns public item ids without title hydration', async () => {
  const { db } = await import('../../lib/db.js');
  const originalConnect = db.connect.bind(db);
  db.connect = async () => ({
    release() {
      return undefined;
    },
  }) as never;

  try {
    const pkg = await import('../search/title-search.service.js');
    let getTitlesCalls = 0;
    const svc = new pkg.TitleSearchService(
      {
        searchTitles: async () => [],
        discoverTitlesByGenre: async () => [],
        searchPeople: async () => [],
        getTitles: async () => {
          getTitlesCalls += 1;
          return new Map();
        },
        searchSuggestions: async () => [{
          Id: '101',
          Type: 'Movie',
          Name: 'Alpha Movie',
          ProductionYear: 2024,
          ImageTags: null,
          ProviderIds: { Tmdb: '101' },
        }],
      } as never,
      {
        ensureContentIds: async (_client: unknown, identities: Array<{ mediaKey: string }>) => {
          return new Map(identities.map((identity) => [identity.mediaKey, '00000000-0000-0000-0000-000000000101']));
        },
        ensureContentId: async () => null,
      } as never,
    );

    const suggestions = await svc.suggestTitles({ query: 'Alpha', filter: 'all', limit: 8, locale: 'en-US' });

    assert.equal(suggestions[0]?.Id, '00000000000000000000000000000101');
    assert.equal(suggestions[0]?.ProviderIds.Tmdb, '101');
    assert.equal(getTitlesCalls, 0);
  } finally {
    db.connect = originalConnect;
  }
});
function hydrateSearchRecord(record: TmdbTitleRecord): TmdbTitleRecord {
  return {
    ...record,
    hydrationLevel: 'summary',
    raw: {
      ...record.raw,
      Genres: [],
      images: { logos: [] },
    },
  };
}

function createTmdbMovieRecord(overrides: Partial<TmdbTitleRecord> = {}): TmdbTitleRecord {
  return {
    mediaType: 'movie',
    tmdbId: 1,
    language: 'en',
    name: 'Movie',
    originalName: 'Movie',
    overview: null,
    tagline: null,
    releaseDate: '2020-01-01',
    firstAirDate: null,
    status: 'Released',
    posterPath: '/movie.jpg',
    backdropPath: null,
    runtime: 100,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    raw: { vote_average: 7.1 },
    hydrationLevel: 'summary',
    fetchedAt: '2024-01-01T00:00:00.000Z',
    expiresAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function createTmdbShowRecord(overrides: Partial<TmdbTitleRecord> = {}): TmdbTitleRecord {
  return {
    mediaType: 'tv',
    tmdbId: 2,
    language: 'en',
    name: 'Series',
    originalName: 'Series',
    overview: null,
    tagline: null,
    releaseDate: null,
    firstAirDate: '2021-01-01',
    status: 'Returning Series',
    posterPath: '/series.jpg',
    backdropPath: null,
    runtime: null,
    episodeRunTime: [24],
    numberOfSeasons: 1,
    numberOfEpisodes: 12,
    externalIds: {},
    raw: { vote_average: 8.2 },
    hydrationLevel: 'summary',
    fetchedAt: '2024-01-01T00:00:00.000Z',
    expiresAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}
