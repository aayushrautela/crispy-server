import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { ProviderTitleRecord } from './metadata-card.types.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';

seedTestEnv();

test('searchTitles returns empty when query is blank', async () => {
  const pkg = await import('../search/title-search.service.js');
  const svc = new pkg.TitleSearchService(
    { searchTitles: async () => [], discoverTitlesByGenre: async () => [] } as never,
    { ensureContentIds: async () => new Map(), ensureContentId: async () => null } as never,
    { searchTitles: async () => [] } as never,
  );

  const response = await svc.searchTitles({ query: '   ', limit: 10 });
  assert.deepEqual(response, { query: '', items: [] });
});

test('series filter does not request TMDB search types', async () => {
  const pkg = await import('../search/title-search.service.js');

  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('series'), []);
  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('anime'), []);
  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('movies'), ['movie']);
  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('all'), ['movie']);
});

test('all filter combines movie, series, and anime results without TMDB tv search', async () => {
  const { db } = await import('../../lib/db.js');
  const originalConnect = db.connect.bind(db);
  db.connect = async () => ({
    release() {
      return undefined;
    },
  }) as never;

  try {
    const tmdbCalls: Array<{ query: string; limit: number; mediaTypes: string[]; locale?: string | null }> = [];
    const providerCalls: Array<{ query: string; filter: string; limit: number }> = [];
    const ensuredMediaKeys: string[] = [];
    const pkg = await import('../search/title-search.service.js');

    const movieRecord = createTmdbMovieRecord({
      tmdbId: 101,
      name: 'Alpha Movie',
      releaseDate: '2020-01-01',
    });
    const seriesRecord = createProviderTitleRecord({
      mediaType: 'show',
      provider: 'tvdb',
      providerId: '201',
      title: 'Alpha Series',
      releaseDate: '2024-01-01',
    });
    const animeRecord = createProviderTitleRecord({
      mediaType: 'anime',
      provider: 'kitsu',
      providerId: '301',
      title: 'Alpha Anime',
      releaseDate: '2023-01-01',
    });

    const svc = new pkg.TitleSearchService(
      {
        searchTitles: async (query: string, limit: number, mediaTypes: string[], locale?: string | null) => {
          tmdbCalls.push({ query, limit, mediaTypes, locale });
          return [movieRecord];
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
      {
        searchTitles: async (_client: unknown, query: string, filter: string, limit: number) => {
          providerCalls.push({ query, filter, limit });
          return [seriesRecord, animeRecord];
        },
      } as never,
    );

    const response = await svc.searchTitles({ query: 'Alpha', filter: 'all', limit: 2, locale: 'en-US' });

    assert.deepEqual(tmdbCalls, [{ query: 'Alpha', limit: 2, mediaTypes: ['movie'], locale: 'en-US' }]);
    assert.deepEqual(providerCalls, [{ query: 'Alpha', filter: 'all', limit: 2 }]);
    assert.deepEqual(response.items.map((item) => item.mediaType), ['show', 'anime']);
    assert.deepEqual(response.items.map((item) => item.title), ['Alpha Series', 'Alpha Anime']);
    assert.deepEqual(ensuredMediaKeys, ['movie:tmdb:101', 'show:tvdb:201', 'anime:kitsu:301']);
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

function createProviderTitleRecord(overrides: Partial<ProviderTitleRecord> = {}): ProviderTitleRecord {
  return {
    mediaType: 'show',
    provider: 'tvdb',
    providerId: '1',
    title: 'Series',
    originalTitle: 'Series',
    summary: null,
    overview: null,
    releaseDate: '2021-01-01',
    status: 'Continuing',
    posterUrl: 'https://example.com/poster.jpg',
    backdropUrl: null,
    logoUrl: null,
    runtimeMinutes: 24,
    rating: 8.2,
    certification: null,
    genres: [],
    externalIds: {
      tmdb: null,
      imdb: null,
      tvdb: null,
      kitsu: null,
    },
    seasonCount: null,
    episodeCount: null,
    raw: {},
    ...overrides,
  };
}
