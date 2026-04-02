import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv } from '../../test-helpers.js';
import { inferMediaIdentity } from '../identity/media-key.js';

seedTestEnv();

const { resolveShowRouteIdentity, resolveTitleRouteIdentity } = await import('./metadata-query.service.js');

test('resolveTitleRouteIdentity resolves canonical UUIDs through the content identity service', async () => {
  let receivedId: string | null = null;
  const contentIdentityService = {
    resolveMediaIdentity: async (_client: unknown, id: string) => {
      receivedId = id;
      return inferMediaIdentity({ mediaType: 'movie', tmdbId: 77, contentId: id });
    },
  };

  const identity = await resolveTitleRouteIdentity({} as never, contentIdentityService as never, '22222222-2222-4222-8222-222222222255');

  assert.equal(receivedId, '22222222-2222-4222-8222-222222222255');
  assert.equal(identity.mediaType, 'movie');
  assert.equal(identity.contentId, '22222222-2222-4222-8222-222222222255');
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
      assert.equal(error.message, 'Title details require a title id.');
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
      assert.equal(error.message, 'Season details require a show id.');
      return true;
    },
  );
});
