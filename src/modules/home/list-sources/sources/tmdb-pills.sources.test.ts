import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../../test-helpers.js';

seedTestEnv();
const { TmdbTrendingPersonSource, TmdbNewThisWeekSource, TmdbGenreFreshSource, createRng, dayKeyUtc, dailyGenreOrder } = await import('./tmdb-pills.sources.js');
const { TmdbClient } = await import('../../../metadata/providers/tmdb.client.js');
import type { ListSourceCtx, ListSource } from '../list-source.types.js';

function makeCtx(): ListSourceCtx {
  return {
    client: {} as unknown,
    profileId: '',
    locale: 'en',
    region: null,
    isKids: false,
    connectedProviders: [],
    tmdbLanguage: 'en',
    tmdbRegion: undefined,
    limit: 40,
  };
}

function fakeTmdb(handler: (path: string, query: Record<string, unknown>) => Record<string, unknown>) {
  return { request: async (path: string, query: Record<string, unknown> = {}) => handler(path, query) } as unknown as InstanceType<typeof TmdbClient>;
}

test('createRng is deterministic for the same seed', () => {
  const a = createRng('pills-2026-01-01');
  const b = createRng('pills-2026-01-01');
  assert.equal(a.int(100), b.int(100));
  assert.equal(a.int(100), b.int(100));
});

test('dayKeyUtc returns UTC yyyy-mm-dd', () => {
  assert.equal(dayKeyUtc(Date.UTC(2026, 0, 9, 23, 0, 0)), '2026-01-09');
});

test('dailyGenreOrder is stable per day and yields distinct slots', () => {
  const day = '2026-03-15';
  const order1 = dailyGenreOrder(day);
  const order2 = dailyGenreOrder(day);
  assert.deepEqual(order1, order2);
  assert.equal(order1.length, 10);
  assert.notEqual(order1[0]!.tmdbId, order1[1]!.tmdbId);
});

test('TmdbTrendingPersonSource descriptor has actor/actress presets', () => {
  const d = new TmdbTrendingPersonSource().descriptor();
  assert.equal(d.id, 'tmdb.trending-person');
  assert.equal(d.presets?.length, 2);
  assert.equal(d.presets![0]!.sourceConfig.gender, 'actor');
  assert.equal(new TmdbTrendingPersonSource().suggestListKey({ gender: 'actress' }), 'tmdb-trending-actress');
});

test('TmdbTrendingPersonSource builds filmography and names the pill after the person', async () => {
  const src = new TmdbTrendingPersonSource(fakeTmdb((path) => {
    if (path === '/trending/movie/day') return { results: [{ id: 1, media_type: 'movie', genre_ids: [18] }] };
    if (path === '/movie/1') return { id: 1, credits: { cast: [{ id: 99, name: 'Anya', gender: 2, popularity: 50, character: 'X' }] } };
    if (path === '/person/99') return { combined_credits: { cast: [
      { id: 5, title: 'Film C', media_type: 'movie', poster_path: '/c.jpg', release_date: '2022-01-01', vote_average: 7 },
      { id: 6, title: 'Film A', media_type: 'movie', poster_path: '/a.jpg', release_date: '2020-01-01', vote_average: 8 },
      { id: 7, title: 'Film B', media_type: 'movie', poster_path: '/b.jpg', release_date: '2021-01-01', vote_average: 6 },
    ] } };
    return {};
  }));

  const res = await src.fetchItems({ gender: 'actor' }, makeCtx());
  assert.equal(res.items.length, 3);
  assert.deepEqual(res.items[0]!.providerRefs, [{ provider: 'tmdb', providerId: '5' }], 'sorted newest first');
  assert.equal(res.items[0]!.type, 'movie');
  assert.equal(res.meta?.title, 'Anya');
  assert.equal(res.meta?.subtitle, 'Trending today');
});

test('TmdbTrendingPersonSource skips animated filmography entries', async () => {
  const src = new TmdbTrendingPersonSource(fakeTmdb((path) => {
    if (path === '/trending/movie/day') return { results: [{ id: 1, media_type: 'movie', genre_ids: [18] }] };
    if (path === '/movie/1') return { id: 1, credits: { cast: [{ id: 99, name: 'Anya', gender: 2, popularity: 50, character: 'X' }] } };
    if (path === '/person/99') return { combined_credits: { cast: [
      { id: 5, title: 'Toon', media_type: 'movie', poster_path: '/t.jpg', genre_ids: [16], release_date: '2022-01-01' },
      { id: 6, title: 'Film A', media_type: 'movie', poster_path: '/a.jpg', genre_ids: [18], release_date: '2021-01-01' },
      { id: 7, title: 'Film B', media_type: 'movie', poster_path: '/b.jpg', genre_ids: [18], release_date: '2020-01-01' },
      { id: 8, title: 'Film C', media_type: 'movie', poster_path: '/c.jpg', genre_ids: [18], release_date: '2019-01-01' },
    ] } };
    return {};
  }));

  const res = await src.fetchItems({ gender: 'actor' }, makeCtx());
  assert.equal(res.items.length, 3, 'animated credit dropped');
});

test('TmdbTrendingPersonSource returns no items when only voice roles are found', async () => {
  const src = new TmdbTrendingPersonSource(fakeTmdb((path) => {
    if (path === '/trending/movie/day') return { results: [{ id: 1, media_type: 'movie', genre_ids: [18] }] };
    if (path === '/movie/1') return { id: 1, credits: { cast: [{ id: 99, name: 'Anya', gender: 2, popularity: 50, character: '(voice)' }] } };
    return {};
  }));

  const res = await src.fetchItems({ gender: 'actor' }, makeCtx());
  assert.equal(res.items.length, 0);
});

test('TmdbNewThisWeekSource uses now_playing for movies', async () => {
  const calls: string[] = [];
  const src = new TmdbNewThisWeekSource(fakeTmdb((path) => {
    calls.push(path);
    if (path === '/movie/now_playing') return { results: [{ id: 10, title: 'New Movie' }, { id: 11, title: 'New Movie 2' }] };
    return {};
  }));

  const res = await src.fetchItems({ mediaType: 'movie' }, makeCtx());
  assert.ok(calls.includes('/movie/now_playing'));
  assert.equal(res.items.length, 2);
  assert.equal(res.meta?.title, 'New This Week');
});

test('TmdbNewThisWeekSource uses discover/tv for shows', async () => {
  const calls: string[] = [];
  const src = new TmdbNewThisWeekSource(fakeTmdb((path) => {
    calls.push(path);
    if (path === '/discover/tv') return { results: [{ id: 20, name: 'New Show' }] };
    return {};
  }));

  const res = await src.fetchItems({ mediaType: 'tv' }, makeCtx());
  assert.ok(calls.includes('/discover/tv'));
  assert.equal(res.items.length, 1);
  assert.equal(res.meta?.title, 'New Shows This Week');
});

test('TmdbGenreFreshSource picks distinct genres for slot 1 and 2', async () => {
  const src: ListSource<{ pick: number }> = new TmdbGenreFreshSource(fakeTmdb((path) => {
    if (path.includes('/discover/movie')) return { results: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 3, title: 'C' }] };
    return {};
  }));

  const pick1 = await src.fetchItems({ pick: 1 }, makeCtx());
  const pick2 = await src.fetchItems({ pick: 2 }, makeCtx());
  assert.equal(pick1.items.length, 3);
  assert.equal(pick2.items.length, 3);
  assert.notEqual(pick1.meta?.title, pick2.meta?.title);
  assert.ok(String(pick1.meta?.title).endsWith('— Fresh'));
});
