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
    return service;
  });
}

test('getProfileLibrary returns library with profile id', async () => {
  const service = await createMockService();
  const result = await service.getProfileLibrary('user-1', 'profile-1');
  assert.equal(result.profileId, 'profile-1');
  assert.equal(result.source, 'all');
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
