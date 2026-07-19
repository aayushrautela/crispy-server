import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../../test-helpers.js';

seedTestEnv();
const { TmdbDiscoverByGenreSource, TMDB_GENRES } = await import('./tmdb.discover-by-genre.js');

test('TMDB_GENRES maps genre values to movie/tv ids', () => {
  const action = TMDB_GENRES.find((g) => g.value === 'action');
  assert.ok(action);
  assert.equal(action?.movieId, 28);
  assert.equal(action?.tvId, 10759);
});

test('discover-by-genre resolves genre name to id for the configured media type', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeTmdb = {
    discoverTitlesByGenreExtended: async (_client: unknown, opts: Record<string, unknown>) => {
      calls.push(opts);
      return [];
    },
  } as never;

  const source = new TmdbDiscoverByGenreSource(fakeTmdb);
  await source.fetchItems({ mediaType: 'tv', genre: 'action', limit: 5 }, {
    client: {},
    profileId: '',
    locale: 'en',
    region: null,
    isKids: false,
    connectedProviders: [],
    tmdbLanguage: 'en',
    tmdbRegion: undefined,
    limit: 5,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.mediaType, 'tv');
  assert.equal(calls[0]!.genreId, 10759, 'tv action genre id');
});

test('discover-by-genre supports explicit numeric genre id override', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeTmdb = {
    discoverTitlesByGenreExtended: async (_client: unknown, opts: Record<string, unknown>) => {
      calls.push(opts);
      return [];
    },
  } as never;

  const source = new TmdbDiscoverByGenreSource(fakeTmdb);
  await source.fetchItems({ mediaType: 'movie', genreId: 9648, sortBy: 'vote_average.desc' }, {
    client: {},
    profileId: '',
    locale: 'en',
    region: null,
    isKids: false,
    connectedProviders: [],
    tmdbLanguage: 'en',
    tmdbRegion: undefined,
    limit: 10,
  });

  assert.equal(calls[0]!.genreId, 9648);
  assert.equal(calls[0]!.sortBy, 'vote_average.desc');
});
