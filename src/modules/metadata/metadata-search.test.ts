import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

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
  assert.deepEqual(pkg.mapSearchFilterToTmdbTypes('all'), ['movie', 'tv']);
});
