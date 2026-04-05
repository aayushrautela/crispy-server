import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv({});

function createMockRegularCard(overrides: Record<string, unknown> = {}) {
  return {
    mediaKey: 'movie:tmdb:1',
    mediaType: 'movie',
    provider: 'tmdb',
    providerId: '1',
    title: 'Test Movie',
    posterUrl: 'https://img.test/poster.jpg',
    releaseYear: 2024,
    rating: 8.4,
    genre: null,
    subtitle: null,
    ...overrides,
  };
}

function createMockProductItem(mediaOverrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const media = createMockRegularCard(mediaOverrides);
  return {
    media,
    origins: ['native'] as string[],
    ...extra,
  };
}

async function createMockService(overrides: {
  personalMediaService?: Record<string, unknown>;
  providerImportService?: Record<string, unknown>;
} = {}) {
  const { LibraryService } = await import('./library.service.js');
  return new LibraryService(
    {
      countWatchedProducts: async () => 0,
      countWatchlistProducts: async () => 0,
      countRatingsProducts: async () => 0,
      listWatchedPage: async () => ({ items: [], pageInfo: { nextCursor: null, hasMore: false } }),
      listWatchlistPage: async () => ({ items: [], pageInfo: { nextCursor: null, hasMore: false } }),
      listRatingsPage: async () => ({ items: [], pageInfo: { nextCursor: null, hasMore: false } }),
      ...overrides.personalMediaService,
    } as never,
    {
      listConnections: async () => ({ providerAccounts: [] }),
      ...overrides.providerImportService,
    } as never,
  );
}

test('getProfileLibrary returns discovery metadata with profile id', async () => {
  const service = await createMockService({
    personalMediaService: {
      countWatchedProducts: async () => 4,
      countWatchlistProducts: async () => 2,
      countRatingsProducts: async () => 1,
    },
  });

  const result = await service.getProfileLibrary('user-1', 'profile-1');
  assert.equal(result.profileId, 'profile-1');
  assert.equal(result.source, 'canonical_library');
  assert.ok(result.generatedAt);
  assert.deepEqual(result.auth.providers, []);
  assert.deepEqual(result.sections, [
    { id: 'watched', label: 'Watched', order: 0, itemCount: 4 },
    { id: 'watchlist', label: 'Watchlist', order: 1, itemCount: 2 },
    { id: 'rated', label: 'Rated', order: 2, itemCount: 1 },
  ]);
});

test('getProfileLibrarySectionPage maps watched items to library items', async () => {
  const mockWatched = [
    createMockProductItem(
      { providerId: '1', title: 'Test Movie' },
      { watchedAt: '2024-01-15T10:00:00.000Z', origins: ['trakt_import'] },
    ),
  ];
  const service = await createMockService({
    personalMediaService: {
      listWatchedPage: async () => ({
        items: mockWatched,
        pageInfo: { nextCursor: 'cursor-1', hasMore: true },
      }),
    },
  });

  const result = await service.getProfileLibrarySectionPage('user-1', 'profile-1', 'watched', { limit: 25 });
  assert.equal(result.section.id, 'watched');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.media.title, 'Test Movie');
  assert.equal(result.items[0]?.state.watchedAt, '2024-01-15T10:00:00.000Z');
  assert.equal(result.items[0]?.state.addedAt, null);
  assert.deepEqual(result.items[0]?.origins, ['trakt_import']);
  assert.deepEqual(result.pageInfo, { nextCursor: 'cursor-1', hasMore: true });
});

test('getProfileLibrarySectionPage keeps episode-derived watched items renderable as regular cards', async () => {
  const service = await createMockService({
    personalMediaService: {
      listWatchedPage: async () => ({
        items: [
          createMockProductItem(
            {
              mediaType: 'episode',
              providerId: '10:1:5',
              title: 'Episode 5',
            },
            { watchedAt: '2024-01-15T10:00:00.000Z' },
          ),
        ],
        pageInfo: { nextCursor: null, hasMore: false },
      }),
    },
  });

  const result = await service.getProfileLibrarySectionPage('user-1', 'profile-1', 'watched', { limit: 25 });
  assert.equal(result.items[0]?.media.providerId, '10:1:5');
  assert.equal(result.items[0]?.media.title, 'Episode 5');
});

test('getProfileLibrarySectionPage maps watchlist and rated sections from the personal-media boundary', async () => {
  const mockWatchlist = [
    createMockProductItem(
      { providerId: '2', title: 'Watchlisted Movie' },
      { addedAt: '2024-01-10T08:00:00.000Z', origins: ['native'] },
    ),
  ];
  const mockRatings = [
    createMockProductItem(
      { providerId: '3', title: 'Rated Movie' },
      { rating: { value: 9, ratedAt: '2024-01-09T08:00:00.000Z' }, origins: ['simkl_import'] },
    ),
  ];
  const service = await createMockService({
    personalMediaService: {
      listWatchlistPage: async () => ({ items: mockWatchlist, pageInfo: { nextCursor: null, hasMore: false } }),
      listRatingsPage: async () => ({ items: mockRatings, pageInfo: { nextCursor: null, hasMore: false } }),
    },
  });

  const watchlist = await service.getProfileLibrarySectionPage('user-1', 'profile-1', 'watchlist', { limit: 25 });
  const rated = await service.getProfileLibrarySectionPage('user-1', 'profile-1', 'rated', { limit: 25 });
  assert.equal(watchlist.items[0]?.media.title, 'Watchlisted Movie');
  assert.equal(watchlist.items[0]?.state.addedAt, '2024-01-10T08:00:00.000Z');
  assert.deepEqual(watchlist.items[0]?.origins, ['native']);
  assert.equal(rated.items[0]?.media.title, 'Rated Movie');
  assert.equal(rated.items[0]?.state.rating, 9);
  assert.equal(rated.items[0]?.state.ratedAt, '2024-01-09T08:00:00.000Z');
  assert.deepEqual(rated.items[0]?.origins, ['simkl_import']);
});

test('getProfileLibrary includes provider auth state', async () => {
  const service = await createMockService({
    providerImportService: {
      listConnections: async () => ({
        providerAccounts: [
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
      }),
    },
  });

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

test('getProfileLibrary throws for count service errors', async () => {
  const service = await createMockService({
    personalMediaService: {
      countWatchedProducts: async () => { throw new HttpError(404, 'Profile not found.'); },
    },
  });

  await assert.rejects(
    () => service.getProfileLibrary('user-1', 'non-existent'),
    (err: Error) => err.message === 'Profile not found.',
  );
});

test('getProfileLibrarySectionPage throws 404 for unknown section ids', async () => {
  const service = await createMockService();

  await assert.rejects(
    () => service.getProfileLibrarySectionPage('user-1', 'profile-1', 'favorites', { limit: 25 }),
    (err: Error) => err instanceof HttpError && (err as HttpError).statusCode === 404,
  );
});
