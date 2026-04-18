import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';

seedTestEnv();

test('searchTitles returns empty when query is blank', async () => {
  const pkg = await import('../search/title-search.service.js');
  const svc = new pkg.TitleSearchService(
    { searchTitles: async () => [], discoverTitlesByGenre: async () => [] } as never,
    { ensureContentIds: async () => new Map(), ensureContentId: async () => null } as never,
  );

  const response = await svc.searchTitles({ query: '   ', limit: 10 });
  assert.deepEqual(response, { query: '', all: [], movies: [], series: [] });
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
        searchTitles: async (query: string, limit: number, mediaTypes: string[], locale?: string | null) => {
          tmdbCalls.push({ query, limit, mediaTypes, locale });
          return [movieRecord, seriesRecord];
        },
        discoverTitlesByGenre: async () => [],
      } as never,
      {
        ensureContentIds: async (_client: unknown, identities: Array<{ mediaKey: string }>) => {
          ensuredMediaKeys.push(...identities.map((identity) => identity.mediaKey));
          return new Map(identities.map((identity) => [identity.mediaKey, `${identity.mediaKey}:content`]));
        },
        ensureContentId: async () => null,
      } as never,
    );

    const response = await svc.searchTitles({ query: 'Alpha', filter: 'all', limit: 2, locale: 'en-US' });

    assert.deepEqual(tmdbCalls, [{ query: 'Alpha', limit: 2, mediaTypes: ['movie', 'tv'], locale: 'en-US' }]);
    assert.deepEqual(response.movies.map((item) => item.title), ['Alpha Movie']);
    assert.deepEqual(response.series.map((item) => item.title), ['Alpha Series']);
    assert.deepEqual(response.all.map((item) => item.title), ['Alpha Series', 'Alpha Movie']);
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
    const svc = new pkg.TitleSearchService(
      {
        searchTitles: async () => [
          createTmdbMovieRecord({ tmdbId: 41, name: 'Poster Movie', posterPath: '/poster.jpg' }),
          createTmdbShowRecord({ tmdbId: 42, name: 'Hidden Series', posterPath: null }),
          createTmdbShowRecord({ tmdbId: 43, name: 'Visible Series', posterPath: '/series.jpg', firstAirDate: '2022-01-01' }),
        ],
        discoverTitlesByGenre: async () => [],
      } as never,
      {
        ensureContentIds: async (_client: unknown, identities: Array<{ mediaKey: string }>) => {
          return new Map(identities.map((identity) => [identity.mediaKey, `${identity.mediaKey}:content`]));
        },
        ensureContentId: async () => null,
      } as never,
    );

    const response = await svc.searchTitles({ query: 'Visible', filter: 'all', limit: 20 });

    assert.deepEqual(response.series.map((item) => item.title), ['Visible Series']);
    assert.deepEqual(response.all.map((item) => item.title), ['Visible Series', 'Poster Movie']);
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
    const svc = new pkg.TitleSearchService(
      {
        searchTitles: async () => [
          createTmdbShowRecord({ tmdbId: 201, name: 'Naruto', firstAirDate: '2002-10-03', overview: 'Ninja', raw: { vote_average: 8.4 } }),
          createTmdbShowRecord({ tmdbId: 202, name: 'Naruto Lost', firstAirDate: null, overview: null, raw: { vote_average: null } }),
          createTmdbShowRecord({ tmdbId: 203, name: 'Naruto Next', firstAirDate: '2017-04-05', overview: 'Ninja sequel', raw: { vote_average: 7.9 } }),
        ],
        discoverTitlesByGenre: async () => [],
      } as never,
      {
        ensureContentIds: async (_client: unknown, identities: Array<{ mediaKey: string }>) => {
          return new Map(identities.map((identity) => [identity.mediaKey, `${identity.mediaKey}:content`]));
        },
        ensureContentId: async () => null,
      } as never,
    );

    const response = await svc.searchTitles({ query: 'Naruto', filter: 'series', limit: 20 });

    assert.deepEqual(response.series.map((item) => item.title), ['Naruto', 'Naruto Next', 'Naruto Lost']);
    assert.deepEqual(response.all.map((item) => item.title), ['Naruto', 'Naruto Next', 'Naruto Lost']);
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

    const svc = new pkg.TitleSearchService(
      {
        searchTitles: async () => {
          tmdbCalls += 1;
          return tmdbPromise;
        },
        discoverTitlesByGenre: async () => [],
      } as never,
      {
        ensureContentIds: async (_client: unknown, identities: Array<{ mediaKey: string }>) => {
          return new Map(identities.map((identity) => [identity.mediaKey, `${identity.mediaKey}:content`]));
        },
        ensureContentId: async () => null,
      } as never,
    );

    const first = svc.searchTitles({ query: 'Alpha', filter: 'all', limit: 20, locale: 'en-US' });
    const second = svc.searchTitles({ query: 'Alpha', filter: 'all', limit: 20, locale: 'en-US' });

    await Promise.resolve();
    assert.equal(tmdbCalls, 1);

    resolveTmdb([
      createTmdbMovieRecord({ tmdbId: 77, name: 'Alpha Movie', releaseDate: '2024-01-01', posterPath: '/alpha.jpg' }),
    ]);

    const [left, right] = await Promise.all([first, second]);
    assert.deepEqual(left, right);
    assert.equal(tmdbCalls, 1);
  } finally {
    db.connect = originalConnect;
  }
});

function createTmdbMovieRecord(overrides: Partial<TmdbTitleRecord> = {}): TmdbTitleRecord {
  return {
    mediaType: 'movie',
    tmdbId: 1,
    name: 'Movie',
    originalName: 'Movie',
    overview: null,
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
    fetchedAt: '2024-01-01T00:00:00.000Z',
    expiresAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function createTmdbShowRecord(overrides: Partial<TmdbTitleRecord> = {}): TmdbTitleRecord {
  return {
    mediaType: 'tv',
    tmdbId: 2,
    name: 'Series',
    originalName: 'Series',
    overview: null,
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
    fetchedAt: '2024-01-01T00:00:00.000Z',
    expiresAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}
