import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv, createMockMetadataView } from '../../test-helpers.js';

seedTestEnv({});

function createMockMetadataCardView(overrides: Record<string, unknown> = {}) {
  const base = createMockMetadataView(overrides);
  return {
    ...base,
    kind: base.kind as 'title' | 'episode',
    provider: base.provider as 'tmdb',
    providerId: String(base.providerId),
    parentProvider: base.parentProvider as 'tmdb' | null,
    parentProviderId: base.parentProviderId ? String(base.parentProviderId) : null,
  };
}

function createMockProductItem(mediaOverrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const media = createMockMetadataCardView(mediaOverrides);
  return {
    media,
    detailsTarget: {
      kind: 'title' as const,
      titleId: media.id,
      titleMediaType: (media.mediaType === 'episode' ? (media.parentMediaType ?? 'show') : media.mediaType) as 'movie' | 'show' | 'anime',
      highlightEpisodeId: media.kind === 'episode' ? media.id : null,
    },
    playbackTarget: {
      contentId: media.id,
      mediaType: media.mediaType,
      provider: media.provider,
      providerId: media.providerId,
      parentProvider: media.parentProvider,
      parentProviderId: media.parentProviderId,
      seasonNumber: media.seasonNumber,
      episodeNumber: media.episodeNumber,
      absoluteEpisodeNumber: media.absoluteEpisodeNumber,
    },
    episodeContext: media.kind === 'episode' ? {
      episodeId: media.id,
      seasonNumber: media.seasonNumber,
      episodeNumber: media.episodeNumber,
      absoluteEpisodeNumber: media.absoluteEpisodeNumber,
      title: media.title,
      airDate: media.releaseDate,
      runtimeMinutes: media.runtimeMinutes,
      stillUrl: media.artwork.stillUrl,
      overview: media.overview,
    } : null,
    origins: ['native'] as string[],
    ...extra,
  };
}

function createMockService() {
  return import('./library.service.js').then(({ LibraryService }) => {
    const service = new LibraryService(
      { assertOwnedProfile: async () => ({ id: 'profile-1' }) } as never,
      { listProducts: async () => [] } as never,
      { listProducts: async () => [] } as never,
      { listWatchlistProducts: async () => [], listRatingsProducts: async () => [] } as never,
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

test('getProfileLibrary returns watched section items with detailsTarget and playbackTarget', async () => {
  const service = await createMockService();
  const mockWatched = [
    createMockProductItem(
      { id: 'movie-1', title: 'Test Movie' },
      { watchedAt: '2024-01-15T10:00:00.000Z', origins: ['trakt_import'] },
    ),
  ];
  (service as any).watchedService = { listProducts: async () => mockWatched };

  const result = await service.getProfileLibrary('user-1', 'profile-1');
  const watched = result.sections.find((section) => section.id === 'watched');
  assert.equal(watched?.items.length, 1);
  assert.equal(watched?.items[0]?.media.title, 'Test Movie');
  assert.equal(watched?.items[0]?.detailsTarget.titleId, 'movie-1');
  assert.equal(watched?.items[0]?.detailsTarget.kind, 'title');
  assert.equal(watched?.items[0]?.detailsTarget.highlightEpisodeId, null);
  assert.equal(watched?.items[0]?.state.watchedAt, '2024-01-15T10:00:00.000Z');
  assert.deepEqual(watched?.items[0]?.origins, ['trakt_import']);
});

test('getProfileLibrary returns episode-derived items with parent title detailsTarget', async () => {
  const service = await createMockService();
  const mockWatched = [
    createMockProductItem(
      {
        id: 'episode-1',
        mediaType: 'episode',
        kind: 'episode',
        parentMediaType: 'show',
        parentProvider: 'tmdb',
        parentProviderId: '10',
        showTmdbId: 10,
        seasonNumber: 1,
        episodeNumber: 5,
        title: 'Episode 5',
      },
      { watchedAt: '2024-01-15T10:00:00.000Z' },
    ),
  ];
  (service as any).watchedService = { listProducts: async () => mockWatched };

  const result = await service.getProfileLibrary('user-1', 'profile-1');
  const watched = result.sections.find((section) => section.id === 'watched');
  assert.equal(watched?.items.length, 1);
  assert.equal(watched?.items[0]?.detailsTarget.highlightEpisodeId, 'episode-1');
  assert.equal(watched?.items[0]?.playbackTarget?.contentId, 'episode-1');
  assert.equal(watched?.items[0]?.playbackTarget?.seasonNumber, 1);
  assert.equal(watched?.items[0]?.playbackTarget?.episodeNumber, 5);
  assert.notEqual(watched?.items[0]?.episodeContext, null);
  assert.equal(watched?.items[0]?.episodeContext?.episodeId, 'episode-1');
  assert.equal(watched?.items[0]?.episodeContext?.seasonNumber, 1);
});

test('getProfileLibrary returns watchlist and rated sections from WatchCollectionService', async () => {
  const service = await createMockService();
  const mockWatchlist = [
    createMockProductItem(
      { id: 'movie-2', title: 'Watchlisted Movie' },
      { addedAt: '2024-01-10T08:00:00.000Z', origins: ['native'] },
    ),
  ];
  const mockRatings = [
    createMockProductItem(
      { id: 'movie-3', title: 'Rated Movie' },
      { rating: { value: 9, ratedAt: '2024-01-09T08:00:00.000Z' }, origins: ['simkl_import'] },
    ),
  ];
  (service as any).watchCollectionService = {
    listWatchlistProducts: async () => mockWatchlist,
    listRatingsProducts: async () => mockRatings,
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

test('getProfileLibrary throws for service errors', async () => {
  const { LibraryService } = await import('./library.service.js');
  const service = new LibraryService(
    { assertOwnedProfile: async () => ({ id: 'profile-1' }) } as never,
    { listProducts: async () => [] } as never,
    { listProducts: async () => { throw new HttpError(404, 'Profile not found.'); } } as never,
    { listWatchlistProducts: async () => [], listRatingsProducts: async () => [] } as never,
    { listConnections: async () => ({ connections: [], watchDataState: null }) } as never,
  );

  await assert.rejects(
    () => service.getProfileLibrary('user-1', 'non-existent'),
    (err: Error) => err.message === 'Profile not found.'
  );
});
