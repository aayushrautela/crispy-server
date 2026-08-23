import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const MOVIE_ITEM_ID = '550e8400e29b41d4a716446655440000';

test('getItemDetail delegates to metadataTitlePageService', async () => {
  const pkg = await import('./metadata-detail.service.js');

  let calledWith: string | null = null;
  const svc = new pkg.MetadataDetailService({
    getTitlePage: async (itemId: string) => {
      calledWith = itemId;
      return { title: 'Test Movie' };
    },
  } as never);

  const result = await svc.getItemDetail(MOVIE_ITEM_ID, 'en-US');
  assert.equal(calledWith, MOVIE_ITEM_ID);
  assert.deepEqual(result, { title: 'Test Movie' });
});

test('getSeriesEpisodes delegates to metadataTitlePageService', async () => {
  const pkg = await import('./metadata-detail.service.js');

  let calledWith: { itemId: string; language: string | null; season: number | null } | null = null;
  const svc = new pkg.MetadataDetailService({
    getSeriesEpisodes: async (itemId: string, language: string | null, season: number | null) => {
      calledWith = { itemId, language, season };
      return { Items: [], StartIndex: 0, TotalRecordCount: 0, NextCursor: null, HasMore: false, Creators: [] };
    },
  } as never);

  const result = await svc.getSeriesEpisodes(MOVIE_ITEM_ID, 'en-US', 2);
  assert.deepEqual(calledWith, { itemId: MOVIE_ITEM_ID, language: 'en-US', season: 2 });
  assert.deepEqual(result, { Items: [], StartIndex: 0, TotalRecordCount: 0, NextCursor: null, HasMore: false, Creators: [] });
});
