import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';

seedTestEnv();

test('searchTitlesInternal returns empty when query is blank', async () => {
  const pkg = await import('../search/title-search.service.js');
  const svc = new pkg.TitleSearchService(
    { searchTitles: async () => [], discoverTitlesByGenre: async () => [], searchPeople: async () => [], getTitles: async () => new Map() } as never,
    { ensureContentIds: async () => new Map(), ensureContentId: async () => null } as never,
  );

  const internal = await svc.searchTitlesInternal({ query: '   ', limit: 10 });
  assert.deepEqual(internal, { tmdbMatches: [], peopleMatches: [], normalizedQuery: '', normalizedFilter: 'all', limit: 10, locale: null });
});

test('search filter maps series to TMDB tv search types', async () => {
  const pkg = await import('../search/title-search.service.js');

  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('series'), ['tv']);
  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('movies'), ['movie']);
  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('all'), ['movie', 'tv']);
});

test('searchTitlesInternal coalesces identical in-flight requests', async () => {
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

    const first = svc.searchTitlesInternal({ query: 'Alpha', filter: 'all', limit: 20, locale: 'en-US' });
    const second = svc.searchTitlesInternal({ query: 'Alpha', filter: 'all', limit: 20, locale: 'en-US' });

    await Promise.resolve();
    assert.equal(tmdbCalls, 1);

    resolveTmdb([alphaMovie]);

    const [leftInternal, rightInternal] = await Promise.all([first, second]);
    assert.deepEqual(leftInternal, rightInternal);
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
