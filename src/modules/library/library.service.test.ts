import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, createMockMetadataView } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-id', SIMKL_IMPORT_CLIENT_ID: 'simkl-id' });

function createMockService() {
  return import('./library.service.js').then(({ LibraryService }) => {
    const service = new LibraryService(
      { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
      { getForProfile: async () => null } as never,
      { listForProfile: async () => [] } as never,
      { getAccessTokenForAccountProfile: async () => ({ accessToken: 'token' }), getTokenStatusForAccountProfile: async () => ({ tokenState: 'valid' }) } as never,
      { list: async () => [] } as never,
      { list: async () => [] } as never,
      { listWatchlist: async () => [], listRatings: async () => [] } as never,
      { resolvePlayback: async () => ({ item: createMockMetadataView(), show: null, season: null }) } as never,
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
