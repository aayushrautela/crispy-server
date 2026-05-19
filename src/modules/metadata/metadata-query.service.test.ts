import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { resolveTitleItemIdentity, resolveShowItemIdentity } = await import('./metadata-route-identity.js');

function mockContentIdentityService(resolveMediaIdentity: (itemId: string) => Promise<unknown>) {
  return { resolveMediaIdentity } as never;
}

test('resolveTitleItemIdentity returns identity for show itemId via ContentIdentityService', async () => {
  const service = mockContentIdentityService(async () => ({
    mediaKey: 'show:tmdb:1396',
    mediaType: 'show',
    provider: 'tmdb',
    providerId: '1396',
    tmdbId: 1396,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
  }));
  const identity = await resolveTitleItemIdentity({} as never, service, '00000000-0000-0000-0000-000000000000');
  assert.equal(identity.mediaType, 'show');
  assert.equal(identity.provider, 'tmdb');
  assert.equal(identity.providerId, '1396');
});

test('resolveTitleItemIdentity returns identity for movie itemId via ContentIdentityService', async () => {
  const service = mockContentIdentityService(async () => ({
    mediaKey: 'movie:tmdb:487672',
    mediaType: 'movie',
    provider: 'tmdb',
    providerId: '487672',
    tmdbId: 487672,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
  }));
  const identity = await resolveTitleItemIdentity({} as never, service, '00000000-0000-0000-0000-000000000000');
  assert.equal(identity.mediaType, 'movie');
  assert.equal(identity.provider, 'tmdb');
  assert.equal(identity.providerId, '487672');
  assert.equal(identity.tmdbId, 487672);
});

test('resolveTitleItemIdentity rejects non-title itemId', async () => {
  const service = mockContentIdentityService(async () => ({
    mediaKey: 'season:tmdb:1399:s1',
    mediaType: 'season',
    provider: 'tmdb',
    providerId: '1399:s1',
    tmdbId: null,
    showTmdbId: 1399,
    seasonNumber: 1,
    episodeNumber: null,
  }));
  await assert.rejects(
    () => resolveTitleItemIdentity({} as never, service, '00000000-0000-0000-0000-000000000000'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, 'Title routes require a title itemId.');
      return true;
    },
  );
});

test('resolveShowItemIdentity returns identity for show itemId via ContentIdentityService', async () => {
  const service = mockContentIdentityService(async () => ({
    mediaKey: 'show:tmdb:1396',
    mediaType: 'show',
    provider: 'tmdb',
    providerId: '1396',
    tmdbId: 1396,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
  }));
  const identity = await resolveShowItemIdentity({} as never, service, '00000000-0000-0000-0000-000000000000');
  assert.equal(identity.mediaType, 'show');
  assert.equal(identity.provider, 'tmdb');
  assert.equal(identity.providerId, '1396');
});

test('resolveShowItemIdentity rejects movie itemId', async () => {
  const service = mockContentIdentityService(async () => ({
    mediaKey: 'movie:tmdb:487672',
    mediaType: 'movie',
    provider: 'tmdb',
    providerId: '487672',
    tmdbId: 487672,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
  }));
  await assert.rejects(
    () => resolveShowItemIdentity({} as never, service, '00000000-0000-0000-0000-000000000000'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, 'Season routes require a show itemId.');
      return true;
    },
  );
});
