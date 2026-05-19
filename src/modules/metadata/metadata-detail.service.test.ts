import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const MOVIE_ITEM_ID = '550e8400e29b41d4a716446655440000';

test('resolve rejects invalid itemId format (colon-separated)', async () => {
  const pkg = await import('./metadata-detail.service.js');

  const svc = new pkg.MetadataDetailService(
    { buildMetadataView: async () => null } as never,
    { getTitle: async () => null } as never,
    {
      resolveMediaIdentity: async () => ({ tmdbId: 77, mediaType: 'movie' }),
    } as never,
  );

  await assert.rejects(
    () => svc.resolve({ itemId: 'invalid-id-with-colons:tmdb:123' }),
    { name: 'Error' },
  );
});

test('resolve rejects empty itemId', async () => {
  const pkg = await import('./metadata-detail.service.js');

  const svc = new pkg.MetadataDetailService(
    { buildMetadataView: async () => null } as never,
    { getTitle: async () => null } as never,
    {
      resolveMediaIdentity: async () => ({ tmdbId: 77, mediaType: 'movie' }),
    } as never,
  );

  await assert.rejects(
    () => svc.resolve({ itemId: '' }),
    { name: 'Error' },
  );
});

test('getItemDetail delegates to metadataTitlePageService', async () => {
  const pkg = await import('./metadata-detail.service.js');

  let calledWith: string | null = null;
  const svc = new pkg.MetadataDetailService(
    { buildMetadataView: async () => null } as never,
    {
      getTitlePage: async (itemId: string) => {
        calledWith = itemId;
        return { title: 'Test Movie' };
      },
    } as never,
    {
      resolveMediaIdentity: async () => ({ tmdbId: 77, mediaType: 'movie' }),
    } as never,
  );

  const result = await svc.getItemDetail(MOVIE_ITEM_ID, 'en-US');
  assert.equal(calledWith, MOVIE_ITEM_ID);
  assert.deepEqual(result, { title: 'Test Movie' });
});
