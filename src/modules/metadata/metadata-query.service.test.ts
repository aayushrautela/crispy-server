import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { resolveMetadataItemIdentity, resolveSeriesItemIdentity } = await import('./metadata-route-identity.js');

function mockService(impl: Record<string, (client: unknown, itemId: string) => Promise<unknown>>) {
  return impl as never;
}

const PUBLIC_ITEM_ID = '00000000000000000000000000000000';

test('resolveMetadataItemIdentity forwards the public itemId to the identity service', async () => {
  let resolvedItemId: string | null = null;
  const service = mockService({
    resolveMetadataItemIdentity: async (_client: unknown, itemId: string) => {
      resolvedItemId = itemId;
      return {
        mediaKey: 'movie:tmdb:487672',
        mediaType: 'movie',
        provider: 'tmdb',
        providerId: '487672',
        tmdbId: 487672,
        showTmdbId: null,
        seasonNumber: null,
        episodeNumber: null,
      };
    },
  });
  const identity = await resolveMetadataItemIdentity({} as never, service, PUBLIC_ITEM_ID);
  assert.equal(resolvedItemId, PUBLIC_ITEM_ID);
  assert.equal(identity.mediaType, 'movie');
});

test('resolveMetadataItemIdentity accepts any media type (no title-only gate)', async () => {
  const service = mockService({
    resolveMetadataItemIdentity: async () => ({
      mediaKey: 'season:tmdb:1399:s1',
      mediaType: 'season',
      provider: 'tmdb',
      providerId: '1399:s1',
      tmdbId: null,
      showTmdbId: 1399,
      seasonNumber: 1,
      episodeNumber: null,
    }),
  });
  const identity = await resolveMetadataItemIdentity({} as never, service, PUBLIC_ITEM_ID);
  assert.equal(identity.mediaType, 'season');
});

test('resolveSeriesItemIdentity forwards the public itemId to the identity service', async () => {
  let resolvedItemId: string | null = null;
  const service = mockService({
    resolveSeriesItemIdentity: async (_client: unknown, itemId: string) => {
      resolvedItemId = itemId;
      return {
        mediaKey: 'show:tmdb:1396',
        mediaType: 'show',
        provider: 'tmdb',
        providerId: '1396',
        tmdbId: 1396,
        showTmdbId: null,
        seasonNumber: null,
        episodeNumber: null,
      };
    },
  });
  const identity = await resolveSeriesItemIdentity({} as never, service, PUBLIC_ITEM_ID);
  assert.equal(resolvedItemId, PUBLIC_ITEM_ID);
  assert.equal(identity.mediaType, 'show');
});
