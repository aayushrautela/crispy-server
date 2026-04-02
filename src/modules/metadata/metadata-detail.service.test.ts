import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('resolve uses tmdbId directly', async () => {
  const pkg = await import('./metadata-detail.service.js');

  const svc = new pkg.MetadataDetailService(
    { buildMetadataView: async (_client: unknown, identity: { tmdbId: number }) =>
      identity.tmdbId === 77 ? { title: 'Test Movie', mediaType: 'movie' } : null,
    } as never,
    { resolve: async (_client: unknown, params: unknown) => params } as never,
    { getTitle: async () => null } as never,
  );

  const input = { tmdbId: 77, mediaType: 'movie' as const };
  const identity = await (svc as any).resolveIdentity(null, input);
  assert.equal(identity.tmdbId, 77);
  assert.equal(identity.mediaType, 'movie');
});

test('resolve handles imdb external id', async () => {
  const pkg = await import('./metadata-detail.service.js');

  let resolverCalledWith: unknown = null;
  const svc = new pkg.MetadataDetailService(
    { buildMetadataView: async () => null } as never,
    { resolve: async (_client: unknown, params: unknown) => { resolverCalledWith = params; return 88; } } as never,
    { getTitle: async () => null } as never,
  );

  const input = { imdbId: 'tt9999', mediaType: 'show' as const };
  const tmdbId = await (svc as any).resolveTmdbId(null, input, 'show');
  assert.equal(tmdbId, 88);
  assert.deepEqual(resolverCalledWith, { source: 'imdb_id', externalId: 'tt9999', mediaType: 'show' });
});

test('resolve rejects episode without season/episode numbers', async () => {
  const pkg = await import('./metadata-detail.service.js');

  const svc = new pkg.MetadataDetailService(
    { buildMetadataView: async () => null } as never,
    { resolve: async () => 42 } as never,
    { getTitle: async () => null } as never,
  );

  await assert.rejects(
    async () => (svc as any).resolveIdentity(null, { tmdbId: 42, mediaType: 'episode' }),
    (error: unknown) => error instanceof Error && /Episode resolution requires/.test(error.message),
  );
});

test('resolve rejects missing tmdb id for movie/show', async () => {
  const pkg = await import('./metadata-detail.service.js');

  const svc = new pkg.MetadataDetailService(
    { buildMetadataView: async () => null } as never,
    { resolve: async () => null } as never,
    { getTitle: async () => null } as never,
  );

  await assert.rejects(
    async () => (svc as any).resolveIdentity(null, { imdbId: 'tt9999', mediaType: 'movie' }),
    (error: unknown) => error instanceof Error && /Unable to resolve/.test(error.message),
  );
});
