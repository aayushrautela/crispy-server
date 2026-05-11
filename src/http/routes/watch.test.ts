import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv();

test('watch routes require user session actor with access token', async (t) => {
  const { SupabaseUserWatchService } = await import('../../modules/integrations/supabase-user-watch.service.js');
  
  const originals = {
    listContinueWatchingPage: SupabaseUserWatchService.prototype.listContinueWatchingPage,
    recordPlaybackState: SupabaseUserWatchService.prototype.recordPlaybackState,
    markWatched: SupabaseUserWatchService.prototype.markWatched,
    unmarkWatched: SupabaseUserWatchService.prototype.unmarkWatched,
  };

  t.after(() => {
    Object.assign(SupabaseUserWatchService.prototype, originals);
  });

  let receivedAccessToken: string | null = null;
  const watchedCalls: Array<Record<string, unknown>> = [];

  SupabaseUserWatchService.prototype.listContinueWatchingPage = async function (params) {
    receivedAccessToken = params.accessToken;
    return {
      items: [],
      pageInfo: { nextCursor: null, hasMore: false },
    } as never;
  };

  SupabaseUserWatchService.prototype.recordPlaybackState = async function (params) {
    receivedAccessToken = params.accessToken;
  };

  SupabaseUserWatchService.prototype.markWatched = async function (params) {
    receivedAccessToken = params.accessToken;
    watchedCalls.push({ ...params, kind: 'mark' });
  };

  SupabaseUserWatchService.prototype.unmarkWatched = async function (params) {
    receivedAccessToken = params.accessToken;
    watchedCalls.push({ ...params, kind: 'unmark' });
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const listResponse = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/continue-watching',
    headers: auth,
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(receivedAccessToken, 'test-supabase-jwt-token');

  receivedAccessToken = null;

  const eventResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/watch/events',
    headers: auth,
    payload: {
      mediaKey: 'movie:tmdb:1',
      mediaType: 'movie',
      eventType: 'playback_progress',
      positionSeconds: 120,
      durationSeconds: 7200,
    },
  });
  assert.equal(eventResponse.statusCode, 200);
  assert.equal(receivedAccessToken, 'test-supabase-jwt-token');

  receivedAccessToken = null;

  const markResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/watch/mark-watched',
    headers: auth,
    payload: {
      mediaKey: 'movie:tmdb:1',
      mediaType: 'movie',
      occurredAt: '2026-05-11T10:00:00.000Z',
    },
  });
  assert.equal(markResponse.statusCode, 200);
  assert.equal(receivedAccessToken, 'test-supabase-jwt-token');

  const unmarkResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/watch/unmark-watched',
    headers: auth,
    payload: {
      mediaKey: 'movie:tmdb:1',
      mediaType: 'movie',
    },
  });
  assert.equal(unmarkResponse.statusCode, 200);

  assert.deepEqual(watchedCalls, [
    {
      accessToken: 'test-supabase-jwt-token',
      profileId: 'profile-1',
      mediaKey: 'movie:tmdb:1',
      titleMediaKey: 'movie:tmdb:1',
      mediaType: 'movie',
      occurredAt: '2026-05-11T10:00:00.000Z',
      kind: 'mark',
    },
    {
      accessToken: 'test-supabase-jwt-token',
      profileId: 'profile-1',
      mediaKey: 'movie:tmdb:1',
      titleMediaKey: 'movie:tmdb:1',
      mediaType: 'movie',
      occurredAt: undefined,
      kind: 'unmark',
    },
  ]);
});

test('watch routes reject requests without access token', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: authPlugin } = await import('../plugins/auth.js');
  const { registerWatchRoutes } = await import('./watch.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/continue-watching',
  });

  assert.equal(response.statusCode, 401);
  const body = response.json();
  assert.equal(body.error.code, 'missing_bearer_token');
  assert.equal(body.error.message, 'Missing bearer token.');
});
