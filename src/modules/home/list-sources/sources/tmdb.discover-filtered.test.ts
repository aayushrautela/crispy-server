import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../../test-helpers.js';

seedTestEnv();
const { TmdbDiscoverFilteredSource, suggestListKey } = await import('./tmdb.discover-filtered.js');

const source = new TmdbDiscoverFilteredSource();

function fakeCtx(): any {
  return {
    client: {},
    profileId: '',
    locale: 'en',
    tmdbLanguage: 'en',
    region: null,
    tmdbRegion: undefined,
    isKids: false,
    connectedProviders: [],
    limit: 5,
  };
}

test('suggestListKey omits empty/Any segments', () => {
  assert.equal(
    suggestListKey({ feed: 'popular', mediaType: 'movie', genre: '', year: '', originalLanguage: '' }),
    'tmdb-popular-movie',
  );
  assert.equal(
    suggestListKey({ feed: 'discover', mediaType: 'tv', genre: 'action', year: 2024, originalLanguage: 'hi' }),
    'tmdb-discover-tv-action-2024-hi',
  );
});

test('descriptor exposes all feeds and filters as selects', () => {
  const d = source.descriptor();
  assert.equal(d.id, 'tmdb.discover-filtered');
  const keys = d.configFields.map((f) => f.key);
  for (const k of ['feed', 'mediaType', 'genre', 'year', 'originalLanguage', 'sortBy', 'minRating', 'maxItems']) {
    assert.ok(keys.includes(k), `missing field ${k}`);
  }
  const feedField = d.configFields.find((f) => f.key === 'feed')!;
  assert.ok(feedField.options && feedField.options.length === 8);
});

test('fetchItems routes trending-week to the trending endpoint', async () => {
  let called = '';
  const spy = {
    async fetchTrending(_client: unknown, _mt: string, window: string) {
      called = 'trending:' + window;
      return [];
    },
  };
  // @ts-expect-error partial spy for the test
  const testSource = new TmdbDiscoverFilteredSource(spy);
  await testSource.fetchItems({ feed: 'trending-week', mediaType: 'movie' }, fakeCtx());
  assert.equal(called, 'trending:week');
});

test('fetchItems routes popular to the popular endpoint', async () => {
  let called = '';
  const spy = {
    async fetchPopular(_client: unknown, _mt: string) {
      called = 'popular';
      return [];
    },
  };
  // @ts-expect-error partial spy for the test
  const testSource = new TmdbDiscoverFilteredSource(spy);
  await testSource.fetchItems({ feed: 'popular', mediaType: 'movie' }, fakeCtx());
  assert.equal(called, 'popular');
});

test('fetchItems routes discover to the discover endpoint with filters', async () => {
  let params: any = null;
  const spy = {
    async discoverTitlesByGenreExtended(_client: unknown, p: any) {
      params = p;
      return [];
    },
  };
  // @ts-expect-error partial spy for the test
  const testSource = new TmdbDiscoverFilteredSource(spy);
  await testSource.fetchItems(
    { feed: 'discover', mediaType: 'movie', genre: 'action', year: 2024, originalLanguage: 'hi', sortBy: 'vote_average.desc', minRating: 7 },
    fakeCtx(),
  );
  assert.equal(params.mediaType, 'movie');
  assert.equal(params.genreId, 28, 'action movie genre id');
  assert.equal(params.releaseYear, 2024);
  assert.equal(params.originalLanguage, 'hi');
  assert.equal(params.sortBy, 'vote_average.desc');
  assert.equal(params.voteAverageGte, 7);
});

test('post-filter trims non-discover results by genre/year/rating/language', async () => {
  const records = [
    { mediaType: 'movie' as const, tmdbId: 1, raw: { genre_ids: [28, 12], release_date: '2024-05-01', original_language: 'hi', vote_average: 8.1 } as Record<string, unknown> },
    { mediaType: 'movie' as const, tmdbId: 2, raw: { genre_ids: [35], release_date: '2023-01-01', original_language: 'en', vote_average: 4.0 } as Record<string, unknown> },
  ];
  // @ts-expect-error accessing private for the test
  const filtered = source.postFilter(records as any, { feed: 'popular', mediaType: 'movie', genre: 'action', year: 2024, originalLanguage: 'hi', minRating: 7 } as any);
  assert.equal(filtered.length, 1, 'only the 2024 Hindi action film rated >=7 survives');
  assert.equal(filtered[0]?.tmdbId, 1);
});
