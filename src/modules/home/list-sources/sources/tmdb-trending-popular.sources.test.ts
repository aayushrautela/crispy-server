import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../../test-helpers.js';

seedTestEnv();
const { TmdbTrendingSource, TmdbPopularSource } = await import('./tmdb-trending-popular.sources.js');
const { TmdbClient } = await import('../../../metadata/providers/tmdb.client.js');
import type { ListSourceCtx } from '../list-source.types.js';

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

test('TmdbTrendingSource descriptor exposes movie/show + timeWindow presets', () => {
  const d = new TmdbTrendingSource().descriptor();
  assert.equal(d.id, 'tmdb.trending');
  assert.equal(d.adminCreatable, undefined, 'dynamic source is not admin-creatable');
  assert.equal(d.presets?.length, 2);
  assert.equal(d.presets![0]!.label, 'Trending Movies');
  assert.equal(d.presets![1]!.sourceConfig.mediaType, 'tv');
  assert.equal(new TmdbTrendingSource().suggestListKey({ mediaType: 'show' as never }), 'tmdb-trending-show');
});

test('TmdbTrendingSource hits /trending/{media}/week and returns tmdb refs', async () => {
  const calls: string[] = [];
  const src = new TmdbTrendingSource(fakeTmdb((path) => {
    calls.push(path);
    return { results: [{ id: 11, title: 'A' }, { id: 12, title: 'B' }, { id: 0, title: 'bad' }] };
  }));
  const res = await src.fetchItems({ mediaType: 'movie', timeWindow: 'week' }, makeCtx());
  assert.ok(calls.includes('/trending/movie/week'));
  assert.equal(res.items.length, 2);
  assert.deepEqual(res.items[0]!.providerRefs, [{ provider: 'tmdb', providerId: '11' }]);
  assert.equal(res.items[0]!.type, 'movie');
});

test('TmdbTrendingSource prefers the tv/day path when configured', async () => {
  const calls: string[] = [];
  const src = new TmdbTrendingSource(fakeTmdb((path) => {
    calls.push(path);
    return { results: [] };
  }));
  await src.fetchItems({ mediaType: 'tv', timeWindow: 'day' }, makeCtx());
  assert.ok(calls.includes('/trending/tv/day'));
});

test('TmdbTrendingSource returns empty when tmdb errors', async () => {
  const src = new TmdbTrendingSource(fakeTmdb(() => {
    throw new Error('upstream down');
  }));
  const res = await src.fetchItems({ mediaType: 'movie' }, makeCtx());
  assert.equal(res.items.length, 0);
});

test('TmdbPopularSource descriptor exposes movie/show presets', () => {
  const d = new TmdbPopularSource().descriptor();
  assert.equal(d.id, 'tmdb.popular');
  assert.equal(d.adminCreatable, undefined, 'dynamic source is not admin-creatable');
  assert.equal(d.presets?.length, 2);
  assert.equal(new TmdbPopularSource().suggestListKey({ mediaType: 'tv' }), 'tmdb-popular-tv');
});

test('TmdbPopularSource hits /movie/popular by default', async () => {
  const calls: string[] = [];
  const src = new TmdbPopularSource(fakeTmdb((path) => {
    calls.push(path);
    return { results: [{ id: 7, title: 'X' }] };
  }));
  const res = await src.fetchItems({ mediaType: 'movie' }, makeCtx());
  assert.ok(calls.includes('/movie/popular'));
  assert.equal(res.items.length, 1);
  assert.deepEqual(res.items[0]!.providerRefs, [{ provider: 'tmdb', providerId: '7' }]);
});

test('TmdbPopularSource hits /tv/popular for shows', async () => {
  const calls: string[] = [];
  const src = new TmdbPopularSource(fakeTmdb((path) => {
    calls.push(path);
    return { results: [{ id: 9, name: 'Y' }] };
  }));
  await src.fetchItems({ mediaType: 'tv' }, makeCtx());
  assert.ok(calls.includes('/tv/popular'));
});