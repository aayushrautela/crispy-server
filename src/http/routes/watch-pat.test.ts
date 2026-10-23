import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { AuthActor } from '../../modules/auth/auth.types.js';
import type { ProfileRecord } from '../../modules/profiles/profile-local.service.js';
import type { WatchRoutesDeps } from './watch.js';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const testItemId = '00000000000040008000000000000001';
const PAT_HEADERS = { authorization: 'Bearer cp_pat_watch-test-token' };

const TEST_OWNED_PROFILE: ProfileRecord = {
  id: 'profile-1',
  name: 'Member',
  interfaceLanguage: 'en',
  region: null,
  avatarUrl: null,
  isAdmin: false,
  requirePinToAddProfiles: false,
  hasPin: false,
  isKids: false,
  sortOrder: 1,
  createdByUserId: 'user-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

/**
 * Ownership stub: 'user-1' (PAT tests) and 'auth-subject' (buildTestApp session actor)
 * own profile-1 only. Every other account/profile pair behaves like a missing profile.
 */
function makeOwnershipStub(): NonNullable<WatchRoutesDeps['profileService']> {
  const owners: Record<string, string[]> = { 'user-1': ['profile-1'], 'auth-subject': ['profile-1'] };
  return {
    async requireOwnedProfile(authSubject: string, profileId: string): Promise<ProfileRecord> {
      if (owners[authSubject]?.includes(profileId)) return TEST_OWNED_PROFILE;
      throw new HttpError(404, 'Profile not found.');
    },
  };
}

function makePatActor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    type: 'pat',
    appUserId: 'user-1',
    serviceId: null,
    scopes: ['watch:read'],
    authSubject: 'user-1',
    email: 'test@example.com',
    tokenId: 'pat-token-1',
    consumerId: null,
    accessToken: null,
    ...overrides,
  };
}

async function buildPatApp(
  t: TestContext,
  actor: AuthActor | null,
  deps: WatchRoutesDeps = {},
): Promise<FastifyInstance> {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: authPlugin } = await import('../plugins/auth.js');
  const { PersonalAccessTokenService } = await import('../../modules/auth/personal-access-token.service.js');
  const { registerWatchRoutes } = await import('./watch.js');

  t.mock.method(PersonalAccessTokenService.prototype, 'authenticate', async () => actor);

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register((a) => registerWatchRoutes(a, { profileService: makeOwnershipStub(), ...deps }));
  t.after(() => app.close());
  return app;
}

async function mockWatchReadServices(t: TestContext): Promise<void> {
  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');
  const emptyPage = { items: [], pageInfo: { hasMore: false, nextCursor: null } };
  t.mock.method(LocalUserWatchService.prototype, 'listContinueWatchingPage', async () => emptyPage);
  t.mock.method(LocalUserWatchService.prototype, 'listHistoryPage', async () => emptyPage);
  t.mock.method(LocalUserWatchService.prototype, 'listWatchlistPage', async () => emptyPage);
  t.mock.method(LocalUserWatchService.prototype, 'listRatingsPage', async () => emptyPage);
  t.mock.method(MetadataLanguageService.prototype, 'resolveForProfile', async () => 'en');
}

test("PAT with watch:read can read an owned profile's watch lists", async (t) => {
  const { InMemoryPatWatchReadRateLimitService } = await import('./watch.js');
  const { EpisodicFollowService } = await import('../../modules/watch/episodic-follow.service.js');
  const { db } = await import('../../lib/db.js');

  await mockWatchReadServices(t);
  t.mock.method(EpisodicFollowService.prototype, 'listForProfile', async () => []);
  t.mock.method(db, 'connect', async () => ({ query: async () => ({ rows: [] }), release() {} }));

  const app = await buildPatApp(t, makePatActor(), {
    patWatchReadRateLimitService: new InMemoryPatWatchReadRateLimitService(),
  });

  const read = async (path: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/profiles/profile-1/watch/${path}`,
      headers: PAT_HEADERS,
    });
    assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
    return response.json() as { data: Record<string, unknown> };
  };

  assert.deepEqual((await read('continue-watching')).data.Items, []);
  assert.deepEqual((await read('history')).data.Items, []);
  assert.deepEqual((await read('watchlist')).data.Items, []);
  assert.deepEqual((await read('ratings')).data.Items, []);
  assert.deepEqual((await read('episodic-follow')).data.items, []);

  const generations = await read('generations');
  assert.equal(generations.data.continue_watching, null);
  assert.equal(generations.data.history, null);
  assert.equal(generations.data.watchlist, null);
  assert.equal(generations.data.ratings, null);
  assert.equal(generations.data.home, null);
});

test('PAT cannot read a different profile id of the same account', async (t) => {
  const { InMemoryPatWatchReadRateLimitService } = await import('./watch.js');
  const app = await buildPatApp(t, makePatActor(), {
    patWatchReadRateLimitService: new InMemoryPatWatchReadRateLimitService(),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-2/watch/history',
    headers: PAT_HEADERS,
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.message, 'Profile not found.');
});

test("PAT cannot read another account's profile id", async (t) => {
  const { InMemoryPatWatchReadRateLimitService } = await import('./watch.js');
  const app = await buildPatApp(
    t,
    makePatActor({ appUserId: 'user-2', authSubject: 'user-2', tokenId: 'pat-token-2' }),
    { patWatchReadRateLimitService: new InMemoryPatWatchReadRateLimitService() },
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/history',
    headers: PAT_HEADERS,
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.message, 'Profile not found.');
});

test('PAT without watch:read scope is rejected with 403', async (t) => {
  const app = await buildPatApp(t, makePatActor({ scopes: [] }));

  const response = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/history',
    headers: PAT_HEADERS,
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.message, 'Missing required scope: watch:read');
});

test('PAT cannot call watch write routes (session-only)', async (t) => {
  const app = await buildPatApp(t, makePatActor());

  const markWatched = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/watch/mark-watched',
    headers: PAT_HEADERS,
    payload: { itemId: testItemId },
  });
  assert.equal(markWatched.statusCode, 403);
  assert.equal(markWatched.json().error.message, 'User session authentication required.');

  const rating = await app.inject({
    method: 'PUT',
    url: `/v1/profiles/profile-1/watch/rating/${testItemId}`,
    headers: PAT_HEADERS,
    payload: { liked: true },
  });
  assert.equal(rating.statusCode, 403);
  assert.equal(rating.json().error.message, 'User session authentication required.');
});

test('unknown or revoked PAT is rejected with 401', async (t) => {
  const app = await buildPatApp(t, null);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/history',
    headers: PAT_HEADERS,
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.message, 'Invalid bearer token.');
});

test('per-token rate limit applies to PAT watch reads', async (t) => {
  const { InMemoryPatWatchReadRateLimitService } = await import('./watch.js');
  const app = await buildPatApp(t, makePatActor(), {
    patWatchReadRateLimitService: new InMemoryPatWatchReadRateLimitService(2),
  });

  const url = '/v1/profiles/profile-1/watch/generations';
  assert.equal((await app.inject({ method: 'GET', url, headers: PAT_HEADERS })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url, headers: PAT_HEADERS })).statusCode, 200);

  const limited = await app.inject({ method: 'GET', url, headers: PAT_HEADERS });
  assert.equal(limited.statusCode, 429);
  assert.ok(limited.headers['retry-after']);
  assert.equal(limited.json().error.category, 'rate_limit');
});

test('session users cannot read or mutate another account profile', async (t) => {
  const { buildTestApp } = await import('../../test-helpers.js');
  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp((a) => registerWatchRoutes(a, { profileService: makeOwnershipStub() }));
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const read = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-2/watch/history',
    headers: auth,
  });
  assert.equal(read.statusCode, 404);
  assert.equal(read.json().error.message, 'Profile not found.');

  const write = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-2/watch/mark-watched',
    headers: auth,
    payload: { itemId: testItemId },
  });
  assert.equal(write.statusCode, 404);
  assert.equal(write.json().error.message, 'Profile not found.');

  const owned = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/generations',
    headers: auth,
  });
  assert.equal(owned.statusCode, 200);
});
