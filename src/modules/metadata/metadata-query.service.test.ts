import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv } from '../../test-helpers.js';
import { inferMediaIdentity } from '../identity/media-key.js';

seedTestEnv();

const { resolveShowRouteIdentity, resolveTitleRouteIdentity } = await import('./metadata-route-identity.js');

test('resolveTitleRouteIdentity accepts provider-backed show media keys directly', async () => {
  const contentIdentityService = {
    resolveMediaIdentity: async () => {
      throw new Error('should not resolve content ids for title routes');
    },
  };

  const identity = await resolveTitleRouteIdentity({} as never, contentIdentityService as never, 'show:tvdb:121361');

  assert.equal(identity.mediaType, 'show');
  assert.equal(identity.provider, 'tvdb');
  assert.equal(identity.providerId, '121361');
});

test('resolveTitleRouteIdentity accepts title media keys directly', async () => {
  const contentIdentityService = {
    resolveMediaIdentity: async () => {
      throw new Error('should not resolve content id for media keys');
    },
  };

  const identity = await resolveTitleRouteIdentity({} as never, contentIdentityService as never, 'movie:tmdb:487672');

  assert.equal(identity.mediaType, 'movie');
  assert.equal(identity.provider, 'tmdb');
  assert.equal(identity.providerId, '487672');
  assert.equal(identity.tmdbId, 487672);
});

test('resolveTitleRouteIdentity rejects non-title media keys', async () => {
  await assert.rejects(
    () => resolveTitleRouteIdentity({} as never, {} as never, 'season:tmdb:1399:1'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, 'Unsupported media key format.');
      return true;
    },
  );
});

test('resolveShowRouteIdentity rejects movie media keys', async () => {
  await assert.rejects(
    () => resolveShowRouteIdentity({} as never, {} as never, 'movie:tmdb:487672'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, 'Season routes require a show or anime mediaKey.');
      return true;
    },
  );
});
