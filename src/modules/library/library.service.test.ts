import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, createMockMetadataView } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-id', SIMKL_IMPORT_CLIENT_ID: 'simkl-id' });

function createMockService(metadataDirectServiceOverrides: Record<string, unknown> = {}) {
  return import('./library.service.js').then(({ LibraryService }) => {
    const metadataDirectService = {
      resolveMetadataView: async () => createMockMetadataView(),
      resolvePlayback: async () => ({ item: createMockMetadataView(), show: null, season: null }),
      ...metadataDirectServiceOverrides,
    };

    const service = new LibraryService(
      { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
      { getForProfile: async () => null } as never,
      { listForProfile: async () => [] } as never,
      { getAccessTokenForAccountProfile: async () => ({ accessToken: 'token' }), getTokenStatusForAccountProfile: async () => ({ tokenState: 'valid' }) } as never,
      { list: async () => [] } as never,
      { list: async () => [] } as never,
      { listWatchlist: async () => [], listRatings: async () => [] } as never,
      metadataDirectService as never,
    );
    service.requireOwnedProfile = async () => {};
    service.getProviderAuthState = async () => [];
    (service as any).getProviderLibraries = async () => [];
    return service;
  });
}

test('getProfileLibrary returns library with profile id', async () => {
  const service = await createMockService();
  const result = await service.getProfileLibrary('user-1', 'profile-1');
  assert.equal(result.profileId, 'profile-1');
  assert.equal(result.source, 'all');
  assert.deepEqual(result.canonical, {
    source: 'canonical_library',
    generatedAt: result.generatedAt,
    continueWatching: [],
    history: [],
    watchlist: [],
    ratings: [],
    items: [],
  });
  assert.deepEqual(result.diagnostics, {
    source: 'provider_diagnostics',
    generatedAt: result.generatedAt,
    providers: [],
  });
});

test('getProfileLibrary respects source filter', async () => {
  const service = await createMockService();
  const result = await service.getProfileLibrary('user-1', 'profile-1', { source: 'trakt' });
  assert.equal(result.source, 'trakt');
});

test('setWatchlist returns success for valid mutation', async () => {
  const service = await createMockService();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;

  try {
    const result = await service.setWatchlist('user-1', 'profile-1', {
      source: 'all', inWatchlist: true, imdbId: 'tt1234567', mediaType: 'movie',
    });
    assert.equal(result.action, 'watchlist');
    assert.ok(result.statusMessage.includes('watchlist'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('setRating rejects simkl rating removal', async () => {
  const service = await createMockService();

  const result = await service.setRating('user-1', 'profile-1', {
    source: 'simkl', rating: null, imdbId: 'tt1234567', mediaType: 'movie',
  });

  assert.equal(result.statusMessage, 'Removing ratings is not supported for Simkl.');
  assert.equal(result.results[0]?.status, 'skipped');
});

test('setRating returns success for valid rating', async () => {
  const service = await createMockService();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;

  try {
    const result = await service.setRating('user-1', 'profile-1', {
      source: 'trakt', rating: 8, imdbId: 'tt1234567', mediaType: 'movie',
    });
    assert.equal(result.action, 'rating');
    assert.equal(result.rating, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('hydrateProviderItems keeps canonical ids and explicit external ids', async () => {
  const service = await createMockService({
    resolveMetadataView: async () => createMockMetadataView({
      id: '55555555-5555-4555-8555-555555555555',
      externalIds: { tmdb: 77, imdb: 'tt1234567', tvdb: 88 },
    }),
  });

  const hydrated = await (service as any).hydrateProviderItems([
    {
      provider: 'trakt',
      folderId: 'watchlist',
      contentId: 'tt1234567',
      contentType: 'movie',
      externalIds: { tmdb: 77, imdb: 'tt1234567', tvdb: 88 },
      title: 'Fallback title',
      posterUrl: null,
      backdropUrl: null,
      seasonNumber: null,
      episodeNumber: null,
      addedAt: '2024-01-01T00:00:00.000Z',
      media: null,
      resolveInput: { imdbId: 'tt1234567', mediaType: 'movie' },
    },
  ]);

  assert.equal(hydrated[0]?.contentId, '55555555-5555-4555-8555-555555555555');
  assert.deepEqual(hydrated[0]?.externalIds, { tmdb: 77, imdb: 'tt1234567', tvdb: 88 });
});

test('getProfileLibrary dedupes provider items into canonical library items', async () => {
  const service = await createMockService();

  service.getProviderAuthState = async () => [];
  (service as any).getProviderLibraries = async () => [
    {
      provider: 'trakt',
      status: 'connected',
      statusMessage: '',
      folders: [{ id: 'watchlist', label: 'Watchlist', provider: 'trakt', itemCount: 1 }],
      items: [{
        provider: 'trakt',
        folderId: 'watchlist',
        contentId: 'tt1234567',
        contentType: 'movie',
        externalIds: { tmdb: 77, imdb: 'tt1234567', tvdb: 88 },
        title: 'Movie One',
        posterUrl: 'https://image/one.jpg',
        backdropUrl: null,
        seasonNumber: null,
        episodeNumber: null,
        addedAt: '2024-01-01T00:00:00.000Z',
        media: createMockMetadataView({ mediaKey: 'movie:tmdb:77', tmdbId: 77 }),
      }],
    },
    {
      provider: 'simkl',
      status: 'connected',
      statusMessage: '',
      folders: [{ id: 'plantowatch-movies', label: 'Plan To Watch', provider: 'simkl', itemCount: 1 }],
      items: [{
        provider: 'simkl',
        folderId: 'plantowatch-movies',
        contentId: 'tt1234567',
        contentType: 'movie',
        externalIds: { tmdb: 77, imdb: 'tt1234567', tvdb: 88 },
        title: 'Movie One Duplicate',
        posterUrl: null,
        backdropUrl: 'https://image/backdrop.jpg',
        seasonNumber: null,
        episodeNumber: null,
        addedAt: '2024-02-01T00:00:00.000Z',
        media: createMockMetadataView({ mediaKey: 'movie:tmdb:77', tmdbId: 77 }),
      }],
    },
  ];

  const result = await service.getProfileLibrary('user-1', 'profile-1');

  assert.equal(result.canonical.items.length, 1);
  assert.equal(result.canonical.source, 'canonical_library');
  assert.equal(result.canonical.generatedAt, result.generatedAt);
  assert.equal(result.diagnostics.source, 'provider_diagnostics');
  assert.equal(result.diagnostics.generatedAt, result.generatedAt);
  assert.equal(result.diagnostics.providers.length, 2);
  assert.deepEqual(result.canonical.items[0], {
    key: 'movie:tmdb:77',
    mediaKey: 'movie:tmdb:77',
    contentId: 'tt1234567',
    contentType: 'movie',
    externalIds: { tmdb: 77, imdb: 'tt1234567', tvdb: 88 },
    title: 'Movie One',
    posterUrl: 'https://image/one.jpg',
    backdropUrl: 'https://image/backdrop.jpg',
    seasonNumber: null,
    episodeNumber: null,
    addedAt: '2024-02-01T00:00:00.000Z',
    providers: ['trakt', 'simkl'],
    folderIds: ['watchlist', 'plantowatch-movies'],
    media: createMockMetadataView({ mediaKey: 'movie:tmdb:77', tmdbId: 77 }),
  });
});
