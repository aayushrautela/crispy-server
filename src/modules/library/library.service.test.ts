import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv, createMockMetadataView } from '../../test-helpers.js';

seedTestEnv({});

function createMockService() {
  return import('./library.service.js').then(({ LibraryService }) => {
    const service = new LibraryService(
      { assertOwnedProfile: async () => ({ id: 'profile-1' }) } as never,
      { list: async () => [] } as never,
      { list: async () => [] } as never,
      { listWatchlist: async () => [], listRatings: async () => [] } as never,
      { listConnections: async () => ({ connections: [], watchDataState: null }) } as never,
    );
    return service;
  });
}

test('getProfileLibrary returns library with profile id', async () => {
  const service = await createMockService();
  const result = await service.getProfileLibrary('user-1', 'profile-1');
  assert.equal(result.profileId, 'profile-1');
   assert.equal(result.source, 'canonical_library');
  assert.ok(result.generatedAt);
   assert.deepEqual(result.auth.providers, []);
   assert.deepEqual(result.sections.map((section) => section.id), ['watched', 'watchlist', 'rated']);
});

test('getProfileLibrary returns watched section items from WatchedQueryService', async () => {
  const service = await createMockService();
  const mockWatched = [
    {
      media: createMockMetadataView({ id: 'movie-1', title: 'Test Movie' }),
      watchedAt: '2024-01-15T10:00:00.000Z',
      payload: { provider: 'trakt' },
    },
  ];
  (service as any).watchedService = { list: async () => mockWatched };

  const result = await service.getProfileLibrary('user-1', 'profile-1');
   const watched = result.sections.find((section) => section.id === 'watched');
   assert.equal(watched?.items.length, 1);
   assert.equal(watched?.items[0]?.media.title, 'Test Movie');
   assert.equal(watched?.items[0]?.detailsTarget.id, 'movie-1');
   assert.equal(watched?.items[0]?.state.watchedAt, '2024-01-15T10:00:00.000Z');
   assert.deepEqual(watched?.items[0]?.origins, ['trakt_import']);
});

test('getProfileLibrary returns watchlist and rated sections from WatchCollectionService', async () => {
  const service = await createMockService();
  const mockWatchlist = [
    {
      media: createMockMetadataView({ id: 'movie-2', title: 'Watchlisted Movie' }),
      addedAt: '2024-01-10T08:00:00.000Z',
      payload: {},
    },
   ];
   const mockRatings = [
    {
      media: createMockMetadataView({ id: 'movie-3', title: 'Rated Movie' }),
      rating: { value: 9, ratedAt: '2024-01-09T08:00:00.000Z' },
      payload: { provider: 'simkl' },
    },
  ];
   (service as any).watchCollectionService = {
    listWatchlist: async () => mockWatchlist,
    listRatings: async () => mockRatings,
   };

  const result = await service.getProfileLibrary('user-1', 'profile-1');
   const watchlist = result.sections.find((section) => section.id === 'watchlist');
   const rated = result.sections.find((section) => section.id === 'rated');
   assert.equal(watchlist?.items.length, 1);
   assert.equal(watchlist?.items[0]?.media.title, 'Watchlisted Movie');
   assert.equal(watchlist?.items[0]?.state.addedAt, '2024-01-10T08:00:00.000Z');
   assert.deepEqual(watchlist?.items[0]?.origins, ['native']);
   assert.equal(rated?.items.length, 1);
   assert.equal(rated?.items[0]?.media.title, 'Rated Movie');
   assert.equal(rated?.items[0]?.state.rating, 9);
   assert.equal(rated?.items[0]?.state.ratedAt, '2024-01-09T08:00:00.000Z');
   assert.deepEqual(rated?.items[0]?.origins, ['simkl_import']);
});

test('getProfileLibrary includes provider auth state', async () => {
  const service = await createMockService();
  (service as any).providerImportService = {
    listConnections: async () => ({
      connections: [
        {
          id: 'conn-1',
          provider: 'trakt',
          status: 'connected',
          providerUserId: 'user-42',
          externalUsername: 'crispy-user',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: null,
          lastImportJobId: null,
          lastImportCompletedAt: null,
        },
      ],
      watchDataState: null,
    }),
  };

  const result = await service.getProfileLibrary('user-1', 'profile-1');
  assert.deepEqual(result.auth.providers, [
    {
      provider: 'trakt',
      connected: true,
      status: 'connected',
      externalUsername: 'crispy-user',
      statusMessage: 'Connected as crispy-user',
    },
  ]);
});

test('getProfileLibrary throws 404 for non-existent profile', async () => {
  const { LibraryService } = await import('./library.service.js');
  const service = new LibraryService(
    { assertOwnedProfile: async () => ({ id: 'profile-1' }) } as never,
    { list: async () => [] } as never,
    { list: async () => { throw new HttpError(404, 'Profile not found.'); } } as never,
    { listWatchlist: async () => [], listRatings: async () => [] } as never,
    { listConnections: async () => ({ connections: [], watchDataState: null }) } as never,
  );

  await assert.rejects(
    () => service.getProfileLibrary('user-1', 'non-existent'),
    (err: Error) => err.message === 'Profile not found.'
  );
});
