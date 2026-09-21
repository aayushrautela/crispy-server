import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../../test-helpers.js';
import type { MdbListListItemRef } from '../../../integrations/mdblist-lists.service.js';
import type { ListSourceCtx } from '../list-source.types.js';

seedTestEnv();
const { parseMdblistListUrl, MdbListPublicListSource } = await import('./mdblist.sources.js');

const BASE_CTX: ListSourceCtx = {
  client: null,
  profileId: '',
  locale: 'en',
  region: null,
  isKids: false,
  connectedProviders: [],
  tmdbLanguage: 'en',
  tmdbRegion: undefined,
  limit: 20,
};

test('parseMdblistListUrl extracts username + listname from mdblist.com URL', () => {
  const parsed = parseMdblistListUrl('https://mdblist.com/lists/linaspurinis/latest-certified-fresh-releases');
  assert.equal(parsed?.username, 'linaspurinis');
  assert.equal(parsed?.listname, 'latest-certified-fresh-releases');
});

test('parseMdblistListUrl tolerates a trailing /json path', () => {
  const parsed = parseMdblistListUrl('https://mdblist.com/lists/garycrawfordgc/top-movies-of-the-week/json');
  assert.equal(parsed?.username, 'garycrawfordgc');
  assert.equal(parsed?.listname, 'top-movies-of-the-week');
});

test('parseMdblistListUrl returns null for invalid URLs', () => {
  assert.equal(parseMdblistListUrl('https://example.com/foo'), null);
  assert.equal(parseMdblistListUrl('not a url'), null);
  assert.equal(parseMdblistListUrl(''), null);
});

test('MdbListPublicListSource descriptor is URL-only with no presets', () => {
  const source = new MdbListPublicListSource();
  const d = source.descriptor();
  assert.equal(d.id, 'mdblist.public-list');
  assert.equal(d.presets, undefined, 'public list has no presets — admin pastes a URL');
  const keys = d.configFields.map((f) => f.key);
  assert.ok(keys.includes('listUrl'));
  assert.ok(keys.includes('mediaType'));
  assert.ok(keys.includes('limit'));
});

test('MdbListPublicListSource suggestListKey derives from URL', () => {
  const source = new MdbListPublicListSource();
  const key = source.suggestListKey({ listUrl: 'https://mdblist.com/lists/linaspurinis/latest-certified-fresh-releases' });
  assert.equal(key, 'mdblist-list-linaspurinis-latest-certified-fresh-releases');
});

test('MdbListPublicListSource suggestListKey falls back for unparseable URLs', () => {
  const source = new MdbListPublicListSource();
  assert.equal(source.suggestListKey({ listUrl: '' }), 'mdblist-list');
});

test('MdbListPublicListSource fetchItems maps show entries to tv items', async () => {
  const items: MdbListListItemRef[] = [
    { mediaType: 'movie', tmdbId: 603, imdbId: null, tvdbId: null, title: 'The Matrix' },
    { mediaType: 'show', tmdbId: 1399, imdbId: 'tt0944947', tvdbId: 121361, title: 'Game of Thrones' },
  ];
  const fakeService = {
    fetchListInfo: async () => ({ name: 'Great List', description: null, mediatype: null }),
    fetchListItems: async () => items,
  };
  const source = new MdbListPublicListSource(fakeService as never);
  const result = await source.fetchItems(
    { listUrl: 'https://mdblist.com/lists/foo/bar', mediaType: '' },
    BASE_CTX,
  );
  assert.equal(result.items.length, 2);
  const matrix = result.items[0];
  assert.equal(matrix?.type, 'movie');
  assert.deepEqual(matrix?.providerRefs, [{ provider: 'tmdb', providerId: '603' }]);
  const got = result.items[1];
  assert.equal(got?.type, 'tv');
  assert.deepEqual(got?.providerRefs, [
    { provider: 'tmdb', providerId: '1399' },
    { provider: 'tvdb', providerId: '121361' },
    { provider: 'imdb', providerId: 'tt0944947' },
  ]);
  assert.equal(result.meta?.name, 'Great List');
});

test('MdbListPublicListSource fetchItems passes the media type filter as show', async () => {
  const calls: Array<{ username: string; slug: string; options?: unknown }> = [];
  const fakeService = {
    fetchListInfo: async () => null,
    fetchListItems: async (username: string, slug: string, options?: unknown) => {
      calls.push({ username, slug, options });
      return [];
    },
  };
  const source = new MdbListPublicListSource(fakeService as never);
  await source.fetchItems(
    { listUrl: 'https://mdblist.com/lists/foo/bar', mediaType: 'tv', limit: 30 },
    BASE_CTX,
  );
  assert.deepEqual(calls[0]?.options, { mediaTypeFilter: 'show', limit: 20 });
});

test('MdbListPublicListSource fetchItems returns empty for a blank URL', async () => {
  const source = new MdbListPublicListSource();
  const result = await source.fetchItems({ listUrl: '   ' }, BASE_CTX);
  assert.equal(result.items.length, 0);
});