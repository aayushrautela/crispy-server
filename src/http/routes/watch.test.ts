import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientMediaCard } from '../../modules/recommendations/client-home.types.js';
import type { WatchInternalRef } from '../../modules/watch/watch-read.types.js';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv();

const testItemId = '00000000000040008000000000000001';
const testTitleItemId = '00000000000040008000000000000002';

function makeClientMediaCard(id: string): ClientMediaCard {
  return {
    itemId: id,
    mediaType: 'movie',
    title: 'Test Movie',
    overview: null,
    year: null,
    releaseDate: null,
    rating: null,
    maturityRating: null,
    genres: [],
    runtimeSeconds: null,
    images: { poster: null, backdrop: null, logo: null, still: null },
    trailerUrl: null,
    progress: null,
    parent: null,
    providerIds: { tmdb: '694', tvdb: null, imdb: null },
  };
}

function makeWatchInternalRef(id: string, progress: WatchInternalRef['progress'] = null): WatchInternalRef {
  return {
    itemId: id,
    mediaType: 'movie',
    progress,
  };
}

test('watch routes work with user actor auth subject', async (t) => {
  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { WatchCardHydrator } = await import('../../modules/watch/watch-card-hydrator.service.js');

  const originals = {
    listContinueWatchingPage: LocalUserWatchService.prototype.listContinueWatchingPage,
    recordPlaybackState: LocalUserWatchService.prototype.recordPlaybackState,
    markWatched: LocalUserWatchService.prototype.markWatched,
    unmarkWatched: LocalUserWatchService.prototype.unmarkWatched,
    hydrateByIds: WatchCardHydrator.prototype.hydrateByIds,
  };
  const { ContentIdentityService } = await import('../../modules/identity/content-identity.service.js');
  const { ContentIdentityRepository } = await import('../../modules/identity/content-identity.repo.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');
  const originalResolveForProfile = MetadataLanguageService.prototype.resolveForProfile;

  t.after(() => {
    LocalUserWatchService.prototype.listContinueWatchingPage = originals.listContinueWatchingPage;
    LocalUserWatchService.prototype.recordPlaybackState = originals.recordPlaybackState;
    LocalUserWatchService.prototype.markWatched = originals.markWatched;
    LocalUserWatchService.prototype.unmarkWatched = originals.unmarkWatched;
    WatchCardHydrator.prototype.hydrateByIds = originals.hydrateByIds;
    MetadataLanguageService.prototype.resolveForProfile = originalResolveForProfile;
  });

  let receivedAccountId: string | null = null;
  const watchedCalls: Array<Record<string, unknown>> = [];

  // @ts-ignore
  LocalUserWatchService.prototype.listContinueWatchingPage = async function (params) {
    receivedAccountId = params.accountId;
    return {
      items: [],
      pageInfo: { nextCursor: null, hasMore: false },
    } as never;
  };

  LocalUserWatchService.prototype.recordPlaybackState = async function (params) {
    receivedAccountId = params.accountId;
  };

  LocalUserWatchService.prototype.markWatched = async function (params) {
    receivedAccountId = params.accountId;
    watchedCalls.push({ ...params, kind: 'mark' });
    return { accepted: true };
  };

  LocalUserWatchService.prototype.unmarkWatched = async function (params) {
    receivedAccountId = params.accountId;
    watchedCalls.push({ ...params, kind: 'unmark' });
    return { accepted: true };
  };

  // @ts-ignore
  WatchCardHydrator.prototype.hydrateByIds = async function (_client, refs) {
    return refs.map((ref) => makeClientMediaCard(ref.itemId)) as never;
  };

  ContentIdentityService.prototype.resolveTitleItemIdForPlayableItemId = async function (_client, itemId: string) {
    return { publicTitleItemId: itemId, mediaType: 'movie' };
  };

  ContentIdentityService.prototype.canonicalizePlayableItemId = async function (_client, publicItemId: string) {
    return '00000000-0000-4000-8000-000000000001';
  };

  ContentIdentityRepository.prototype.findContentItemById = async function (_client, _contentId: string) {
    return { contentId: _contentId, entityType: 'movie' as const };
  };

  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en-US';
  };

  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

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
  assert.equal(receivedAccountId, 'auth-subject');

  receivedAccountId = null;

  const eventResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/watch/events',
    headers: auth,
    payload: {
      itemId: testItemId,
      eventType: 'playback_progress',
      positionSeconds: 120,
      durationSeconds: 7200,
    },
  });
  assert.equal(eventResponse.statusCode, 200);

  const { getPlaybackProgressBuffer } = await import('../../modules/watch/playback-progress-buffer.service.js');
  await getPlaybackProgressBuffer().flush();

  assert.equal(receivedAccountId, 'auth-subject');

  receivedAccountId = null;

  const markResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/watch/mark-watched',
    headers: auth,
    payload: {
      itemId: testItemId,
      occurredAt: '2026-05-11T10:00:00.000Z',
    },
  });
  assert.equal(markResponse.statusCode, 200);
  assert.equal(receivedAccountId, 'auth-subject');

  const unmarkResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/watch/unmark-watched',
    headers: auth,
    payload: {
      itemId: testItemId,
    },
  });
  assert.equal(unmarkResponse.statusCode, 200);

  assert.deepEqual(watchedCalls, [
    {
      accountId: 'auth-subject',
      profileId: 'profile-1',
      itemId: '00000000-0000-4000-8000-000000000001',
      titleItemId: '00000000-0000-4000-8000-000000000001',
      mediaType: 'movie',
      occurredAt: '2026-05-11T10:00:00.000Z',
      kind: 'mark',
    },
    {
      accountId: 'auth-subject',
      profileId: 'profile-1',
      itemId: '00000000-0000-4000-8000-000000000001',
      titleItemId: '00000000-0000-4000-8000-000000000001',
      mediaType: 'movie',
      occurredAt: undefined,
      kind: 'unmark',
    },
  ]);
});

test('dismiss continue-watching resolves titleItemId from playableItemId', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { WatchCardHydrator } = await import('../../modules/watch/watch-card-hydrator.service.js');
  const { ContentIdentityService } = await import('../../modules/identity/content-identity.service.js');
  const { ContentIdentityRepository } = await import('../../modules/identity/content-identity.repo.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');

  const originalResolveForProfile = MetadataLanguageService.prototype.resolveForProfile;
  const originalHydrateByIds = WatchCardHydrator.prototype.hydrateByIds;
  t.after(() => {
    MetadataLanguageService.prototype.resolveForProfile = originalResolveForProfile;
    WatchCardHydrator.prototype.hydrateByIds = originalHydrateByIds;
  });

  const dismissParams: Partial<Record<string, string>> = {};
  LocalUserWatchService.prototype.dismissContinueWatching = async function (params: { titleItemId: string; playableItemId: string; profileId: string }) {
    Object.assign(dismissParams, params);
    return { accepted: true };
  };
  // @ts-ignore
  WatchCardHydrator.prototype.hydrateByIds = async function () {
    return [] as never;
  };
  ContentIdentityService.prototype.resolveTitleItemIdForPlayableItemId = async function (_client, itemId: string) {
    return { publicTitleItemId: itemId, mediaType: 'episode' };
  };
  ContentIdentityRepository.prototype.findContentItemById = async function (_client, _contentId: string) {
    return { contentId: _contentId, entityType: 'episode' as const };
  };
  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en' as never;
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'DELETE',
    url: `/v1/profiles/profile-1/watch/continue-watching/${testTitleItemId}`,
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(dismissParams?.titleItemId, '00000000-0000-4000-8000-000000000002');
  assert.equal(dismissParams?.playableItemId, '00000000-0000-4000-8000-000000000002');
  assert.equal(dismissParams?.profileId, 'profile-1');
});

test('delete watch history routes to service with resolved mediaType', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { ContentIdentityRepository } = await import('../../modules/identity/content-identity.repo.js');

  const deleteHistoryCalls: Array<Record<string, unknown>> = [];
  LocalUserWatchService.prototype.deleteHistory = async function (params) {
    deleteHistoryCalls.push({ ...params });
    return { accepted: true };
  };
  ContentIdentityRepository.prototype.findContentItemById = async function (_client, _contentId: string) {
    return { contentId: _contentId, entityType: 'movie' as const };
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const movieResponse = await app.inject({
    method: 'DELETE',
    url: `/v1/profiles/profile-1/watch/history/${testItemId}`,
    headers: auth,
  });
  assert.equal(movieResponse.statusCode, 200);

  // season entity resolves to season mediaType and is passed through
  ContentIdentityRepository.prototype.findContentItemById = async function (_client, _contentId: string) {
    return { contentId: _contentId, entityType: 'season' as const };
  };
  const seasonResponse = await app.inject({
    method: 'DELETE',
    url: `/v1/profiles/profile-1/watch/history/${testItemId}`,
    headers: auth,
  });
  assert.equal(seasonResponse.statusCode, 200);

  // show + season/episode query params are forwarded for server-side narrowing
  ContentIdentityRepository.prototype.findContentItemById = async function (_client, _contentId: string) {
    return { contentId: _contentId, entityType: 'show' as const };
  };
  const showEpisodeResponse = await app.inject({
    method: 'DELETE',
    url: `/v1/profiles/profile-1/watch/history/${testItemId}?seasonNumber=2&episodeNumber=5`,
    headers: auth,
  });
  assert.equal(showEpisodeResponse.statusCode, 200);

  assert.equal(deleteHistoryCalls.length, 3);
  assert.deepEqual(deleteHistoryCalls[0], {
    accountId: 'auth-subject',
    profileId: 'profile-1',
    itemId: '00000000-0000-4000-8000-000000000001',
    mediaType: 'movie',
    seasonNumber: null,
    episodeNumber: null,
  });
  assert.deepEqual(deleteHistoryCalls[1], {
    accountId: 'auth-subject',
    profileId: 'profile-1',
    itemId: '00000000-0000-4000-8000-000000000001',
    mediaType: 'season',
    seasonNumber: null,
    episodeNumber: null,
  });
  assert.deepEqual(deleteHistoryCalls[2], {
    accountId: 'auth-subject',
    profileId: 'profile-1',
    itemId: '00000000-0000-4000-8000-000000000001',
    mediaType: 'show',
    seasonNumber: 2,
    episodeNumber: 5,
  });
});

test('mark/unmark watched accepts season itemId and cascades mediaType', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { ContentIdentityRepository } = await import('../../modules/identity/content-identity.repo.js');

  const markCalls: Array<Record<string, unknown>> = [];
  const unmarkCalls: Array<Record<string, unknown>> = [];
  LocalUserWatchService.prototype.markWatched = async function (params) {
    markCalls.push({ ...params });
    return { accepted: true };
  };
  LocalUserWatchService.prototype.unmarkWatched = async function (params) {
    unmarkCalls.push({ ...params });
    return { accepted: true };
  };
  ContentIdentityRepository.prototype.findContentItemById = async function (_client, _contentId: string) {
    return { contentId: _contentId, entityType: 'season' as const };
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const markResponse = await app.inject({
    method: 'POST',
    url: `/v1/profiles/profile-1/watch/mark-watched`,
    headers: auth,
    payload: { itemId: testItemId },
  });
  assert.equal(markResponse.statusCode, 200);
  assert.equal(markCalls.length, 1);
  assert.equal(markCalls[0]!.mediaType, 'season');
  assert.equal(markCalls[0]!.itemId, '00000000-0000-4000-8000-000000000001');

  const unmarkResponse = await app.inject({
    method: 'POST',
    url: `/v1/profiles/profile-1/watch/unmark-watched`,
    headers: auth,
    payload: { itemId: testItemId },
  });
  assert.equal(unmarkResponse.statusCode, 200);
  assert.equal(unmarkCalls.length, 1);
  assert.equal(unmarkCalls[0]!.mediaType, 'season');
});

test('watch mutations surface a reason when rejected', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { ContentIdentityRepository } = await import('../../modules/identity/content-identity.repo.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');

  const originalResolveForProfile = MetadataLanguageService.prototype.resolveForProfile;
  t.after(() => {
    MetadataLanguageService.prototype.resolveForProfile = originalResolveForProfile;
  });

  LocalUserWatchService.prototype.markWatched = async function () {
    return { accepted: false, reason: 'This item could not be resolved for the selected profile.' };
  };
  ContentIdentityRepository.prototype.findContentItemById = async function (_client, _contentId: string) {
    return { contentId: _contentId, entityType: 'movie' as const };
  };
  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en' as never;
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: `/v1/profiles/profile-1/watch/mark-watched`,
    headers: { authorization: 'Bearer test' },
    payload: { itemId: testItemId },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.accepted, false);
  assert.equal(body.data.reason, 'This item could not be resolved for the selected profile.');
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

test('continue-watching serializes items with progress', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { WatchCardHydrator } = await import('../../modules/watch/watch-card-hydrator.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');

  const originals = {
    listContinueWatchingPage: LocalUserWatchService.prototype.listContinueWatchingPage,
    hydrateByIds: WatchCardHydrator.prototype.hydrateByIds,
  };
  const originalResolveForProfile = MetadataLanguageService.prototype.resolveForProfile;

  t.after(() => {
    LocalUserWatchService.prototype.listContinueWatchingPage = originals.listContinueWatchingPage;
    WatchCardHydrator.prototype.hydrateByIds = originals.hydrateByIds;
    MetadataLanguageService.prototype.resolveForProfile = originalResolveForProfile;
  });

  const now = '2026-05-13T00:00:00.000Z';

  // @ts-ignore
  LocalUserWatchService.prototype.listContinueWatchingPage = async () => ({
    items: [
      makeWatchInternalRef(testItemId, {
        positionSeconds: 120,
        durationSeconds: 7200,
        progressBps: 167,
        played: false,
        playCount: 0,
        isFavorite: false,
        rating: null,
        lastPlayedAt: now,
      }),
    ],
    pageInfo: { nextCursor: null, hasMore: false },
  });

  // @ts-ignore
  WatchCardHydrator.prototype.hydrateByIds = async (_client, refs) => {
    return refs.map((ref) => ({
      ...makeClientMediaCard(ref.itemId),
      progress: ref.progress ? {
        played: ref.progress.played,
        playCount: ref.progress.playCount,
        positionSeconds: ref.progress.positionSeconds,
        durationSeconds: ref.progress.durationSeconds,
        percent: ref.progress.progressBps != null ? ref.progress.progressBps / 100 : null,
        lastPlayedAt: ref.progress.lastPlayedAt,
        watchlisted: ref.progress.isFavorite,
        userRating: ref.progress.rating,
      } : null,
    })) as never;
  };

  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en-US';
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/continue-watching',
    headers: { authorization: 'Bearer test' },
  });

  const body = response.json();
  assert.equal(response.statusCode, 200, JSON.stringify(body, null, 2));
  assert.ok(Array.isArray(body.data.Items));
  assert.equal(body.data.Items.length, 1);
  const item = body.data.Items[0];
  assert.equal(item.itemId, testItemId);
  assert.equal(item.mediaType, 'movie');
  assert.equal(item.progress.positionSeconds, 120);
  assert.equal(item.progress.durationSeconds, 7200);
  assert.equal(item.progress.percent, 1.67);
  assert.equal(item.progress.lastPlayedAt, now);
});

test('watch state serializes progress without status', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { WatchCardHydrator } = await import('../../modules/watch/watch-card-hydrator.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');

  const originals = {
    getStates: LocalUserWatchService.prototype.getStates,
    hydrateByIds: WatchCardHydrator.prototype.hydrateByIds,
  };

  const originalResolveForProfile = MetadataLanguageService.prototype.resolveForProfile;

  t.after(() => {
    LocalUserWatchService.prototype.getStates = originals.getStates;
    WatchCardHydrator.prototype.hydrateByIds = originals.hydrateByIds;
    MetadataLanguageService.prototype.resolveForProfile = originalResolveForProfile;
  });

  const now = '2026-05-13T00:00:00.000Z';

  LocalUserWatchService.prototype.getStates = async () => ([
    makeWatchInternalRef(testItemId, {
      positionSeconds: 120,
      durationSeconds: 7200,
      progressBps: 167,
      played: false,
      playCount: 0,
      isFavorite: false,
      rating: null,
      lastPlayedAt: now,
    }),
  ]);

  // @ts-ignore
  WatchCardHydrator.prototype.hydrateByIds = async (_client, refs) => {
    return refs.map((ref) => ({
      ...makeClientMediaCard(ref.itemId),
      progress: ref.progress ? {
        played: ref.progress.played,
        playCount: ref.progress.playCount,
        positionSeconds: ref.progress.positionSeconds,
        durationSeconds: ref.progress.durationSeconds,
        percent: ref.progress.progressBps != null ? ref.progress.progressBps / 100 : null,
        lastPlayedAt: ref.progress.lastPlayedAt,
        watchlisted: ref.progress.isFavorite,
        userRating: ref.progress.rating,
      } : null,
    })) as never;
  };

  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en-US';
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: `/v1/profiles/profile-1/watch/state?itemId=${testItemId}`,
    headers: { authorization: 'Bearer test' },
  });

  const body = response.json();
  assert.equal(response.statusCode, 200, JSON.stringify(body, null, 2));
  assert.equal(body.data.itemId, testItemId);
  assert.equal(body.data.progress.positionSeconds, 120);
  assert.equal(body.data.progress.durationSeconds, 7200);
  assert.equal(body.data.progress.lastPlayedAt, now);
});

test('watch route requires unlock (locked profile) when profile has a PIN', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { WatchCardHydrator } = await import('../../modules/watch/watch-card-hydrator.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');
  const { setProfileUnlocked, lockProfile } = await import('../../lib/profile-unlock-store.js');
  const { TEST_USER_AUTH } = await import('../../test-helpers.js');

  const originalListContinueWatching = LocalUserWatchService.prototype.listContinueWatchingPage;
  const originalHydrate = WatchCardHydrator.prototype.hydrateByIds;
  const originalResolve = MetadataLanguageService.prototype.resolveForProfile;

  // @ts-ignore
  LocalUserWatchService.prototype.listContinueWatchingPage = async function () {
    return { items: [], pageInfo: { nextCursor: null, hasMore: false } } as never;
  };
  // @ts-ignore
  WatchCardHydrator.prototype.hydrateByIds = async function () {
    return [] as never;
  };
  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en' as never;
  };
  t.after(() => {
    LocalUserWatchService.prototype.listContinueWatchingPage = originalListContinueWatching;
    WatchCardHydrator.prototype.hydrateByIds = originalHydrate;
    MetadataLanguageService.prototype.resolveForProfile = originalResolve;
    void lockProfile('profile-1', TEST_USER_AUTH.appUserId);
    void lockProfile('profile-2', TEST_USER_AUTH.appUserId);
  });

  const fakePin = {
    hasPin: async (profileId: string) => profileId === 'profile-1',
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp((a) => registerWatchRoutes(a, { profilePinService: fakePin }));
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const denied = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/continue-watching',
    headers: auth,
  });
  assert.equal(denied.statusCode, 423);
  assert.equal(denied.json().error.code, 'PROFILE_LOCKED');

  await setProfileUnlocked('profile-1', TEST_USER_AUTH.appUserId);

  const allowed = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/continue-watching',
    headers: auth,
  });
  assert.equal(allowed.statusCode, 200);

  // Unlocking a different profile does not unlock profile-1
  await lockProfile('profile-1', TEST_USER_AUTH.appUserId);
  await setProfileUnlocked('profile-2', TEST_USER_AUTH.appUserId);
  const stillLocked = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/continue-watching',
    headers: auth,
  });
  assert.equal(stillLocked.statusCode, 423);
});

test('watch route allows access when profile has no PIN', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { WatchCardHydrator } = await import('../../modules/watch/watch-card-hydrator.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');

  const originalListContinueWatching = LocalUserWatchService.prototype.listContinueWatchingPage;
  const originalHydrate = WatchCardHydrator.prototype.hydrateByIds;
  const originalResolve = MetadataLanguageService.prototype.resolveForProfile;

  // @ts-ignore
  LocalUserWatchService.prototype.listContinueWatchingPage = async function () {
    return { items: [], pageInfo: { nextCursor: null, hasMore: false } } as never;
  };
  // @ts-ignore
  WatchCardHydrator.prototype.hydrateByIds = async function () {
    return [] as never;
  };
  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en' as never;
  };
  t.after(() => {
    LocalUserWatchService.prototype.listContinueWatchingPage = originalListContinueWatching;
    WatchCardHydrator.prototype.hydrateByIds = originalHydrate;
    MetadataLanguageService.prototype.resolveForProfile = originalResolve;
  });

  const fakePin = {
    hasPin: async (profileId: string) => profileId === 'profile-2', // profile-1 has no PIN
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp((a) => registerWatchRoutes(a, { profilePinService: fakePin }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/continue-watching',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(response.statusCode, 200);
});
