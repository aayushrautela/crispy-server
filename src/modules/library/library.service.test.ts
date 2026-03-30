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
      { listWatchlist: async () => [] } as never,
    );
    return service;
  });
}

test('getProfileLibrary returns library with profile id', async () => {
  const service = await createMockService();
  const result = await service.getProfileLibrary('user-1', 'profile-1');
  assert.equal(result.profileId, 'profile-1');
  assert.ok(result.generatedAt);
  assert.ok(Array.isArray(result.watched));
  assert.ok(Array.isArray(result.watchlist));
});

test('getProfileLibrary returns watched items from WatchedQueryService', async () => {
  const service = await createMockService();
  const mockWatched = [
    {
      media: createMockMetadataView({ id: 'movie-1', title: 'Test Movie' }),
      watchedAt: '2024-01-15T10:00:00.000Z',
    },
  ];
  (service as any).watchedService = { list: async () => mockWatched };

  const result = await service.getProfileLibrary('user-1', 'profile-1');
  assert.equal(result.watched.length, 1);
  assert.equal(result.watched[0]?.media.title, 'Test Movie');
});

test('getProfileLibrary returns watchlist items from WatchCollectionService', async () => {
  const service = await createMockService();
  const mockWatchlist = [
    {
      media: createMockMetadataView({ id: 'movie-2', title: 'Watchlisted Movie' }),
      addedAt: '2024-01-10T08:00:00.000Z',
    },
  ];
  (service as any).watchCollectionService = { listWatchlist: async () => mockWatchlist };

  const result = await service.getProfileLibrary('user-1', 'profile-1');
  assert.equal(result.watchlist.length, 1);
  assert.equal(result.watchlist[0]?.media.title, 'Watchlisted Movie');
});

test('getProfileLibrary throws 404 for non-existent profile', async () => {
  const { LibraryService } = await import('./library.service.js');
  const service = new LibraryService(
    { assertOwnedProfile: async () => { throw new HttpError(404, 'Profile not found.'); } } as never,
    { list: async () => [] } as never,
    { list: async () => [] } as never,
    { listWatchlist: async () => [] } as never,
  );

  await assert.rejects(
    () => service.getProfileLibrary('user-1', 'non-existent'),
    (err: Error) => err.message === 'Profile not found.'
  );
});
