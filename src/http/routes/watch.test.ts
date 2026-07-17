import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv();

const testItemId = '00000000000040008000000000000001';
const testTitleItemId = '00000000000040008000000000000002';

test('watch routes work with user actor auth subject', async (t) => {
  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { WatchMetadataEnrichmentService } = await import('../../modules/watch/watch-metadata-enrichment.service.js');
   
  const originals = {
    listContinueWatchingPage: LocalUserWatchService.prototype.listContinueWatchingPage,
    recordPlaybackState: LocalUserWatchService.prototype.recordPlaybackState,
    markWatched: LocalUserWatchService.prototype.markWatched,
    unmarkWatched: LocalUserWatchService.prototype.unmarkWatched,
    enrichContinueWatchingItems: WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems,
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
    WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems = originals.enrichContinueWatchingItems;
    MetadataLanguageService.prototype.resolveForProfile = originalResolveForProfile;
  });

  let receivedAccountId: string | null = null;
  const watchedCalls: Array<Record<string, unknown>> = [];

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
  };

  LocalUserWatchService.prototype.unmarkWatched = async function (params) {
    receivedAccountId = params.accountId;
    watchedCalls.push({ ...params, kind: 'unmark' });
  };

  WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems = async function (_client, items) {
    return items;
  };

  ContentIdentityService.prototype.resolveTitleItemIdForPlayableItemId = async function (_client, itemId: string) {
    return itemId;
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

function makeMediaItem(id: string) {
  return {
    Id: id,
    Type: 'Movie' as const,
    Name: 'Test Movie',
    OriginalTitle: null,
    Overview: null,
    Taglines: [],
    ProductionYear: null,
    PremiereDate: null,
    CommunityRating: null,
    OfficialRating: null,
    Certification: null,
    Genres: [],
    RunTimeTicks: null,
    Status: null,
    ProviderIds: { Tmdb: '694', Imdb: null, Tvdb: null },
    ImageTags: {
      Primary: { small: null, medium: null, large: null },
      Backdrop: [{ small: null, medium: null, large: null }],
      Logo: null,
      Thumb: null,
      Screenshot: [],
    },
    ParentImageTags: null,
    SeriesId: null,
    SeriesName: null,
    SeasonId: null,
    SeasonName: null,
    ParentIndexNumber: null,
    IndexNumber: null,
    AbsoluteIndexNumber: null,
    EpisodeTitle: null,
    AirDate: null,
    RemoteTrailers: [],
    PosterColor: null,
    BackdropColor: null,
    UserData: null,
  };
}

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
  const { WatchMetadataEnrichmentService } = await import('../../modules/watch/watch-metadata-enrichment.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');

  const originals = {
    listContinueWatchingPage: LocalUserWatchService.prototype.listContinueWatchingPage,
    enrichContinueWatchingItems: WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems,
  };
  const originalResolveForProfile = MetadataLanguageService.prototype.resolveForProfile;

  t.after(() => {
    LocalUserWatchService.prototype.listContinueWatchingPage = originals.listContinueWatchingPage;
    WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems = originals.enrichContinueWatchingItems;
    MetadataLanguageService.prototype.resolveForProfile = originalResolveForProfile;
  });

  const now = '2026-05-13T00:00:00.000Z';

  LocalUserWatchService.prototype.listContinueWatchingPage = async () => ({
    items: [
      {
        ...makeMediaItem(testItemId),
        UserData: {
          ItemId: testItemId,
          IsFavorite: false,
          Played: false,
          PlayCount: 0,
          PlaybackPositionTicks: 1_200_000_000,
          RuntimeTicks: 72_000_000_000,
          PlayedPercentage: 1.67,
          LastPlayedDate: now,
          Rating: null,
          DismissedFromContinueWatching: false,
        },
      },
    ],
    pageInfo: { nextCursor: null, hasMore: false },
  });

  WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems = async (_client, items) => items;

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
  assert.equal(item.Id, testItemId);
  assert.equal(item.Type, 'Movie');
  assert.equal(item.UserData.PlaybackPositionTicks, 1_200_000_000);
  assert.equal(item.UserData.RuntimeTicks, 72_000_000_000);
  assert.equal(item.UserData.PlayedPercentage, 1.67);
  assert.equal(item.UserData.LastPlayedDate, now);
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
  const { WatchMetadataEnrichmentService } = await import('../../modules/watch/watch-metadata-enrichment.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');

  const originals = {
    getState: LocalUserWatchService.prototype.getState,
    enrichRegularMediaItems: WatchMetadataEnrichmentService.prototype.enrichRegularMediaItems,
  };

  const originalResolveForProfile = MetadataLanguageService.prototype.resolveForProfile;

  t.after(() => {
    LocalUserWatchService.prototype.getState = originals.getState;
    WatchMetadataEnrichmentService.prototype.enrichRegularMediaItems = originals.enrichRegularMediaItems;
    MetadataLanguageService.prototype.resolveForProfile = originalResolveForProfile;
  });

  const now = '2026-05-13T00:00:00.000Z';

  LocalUserWatchService.prototype.getState = async () => ({
    ...makeMediaItem(testItemId),
    UserData: {
      ItemId: testItemId,
      IsFavorite: false,
      Played: false,
      PlayCount: 0,
      PlaybackPositionTicks: 1_200_000_000,
      RuntimeTicks: 72_000_000_000,
      PlayedPercentage: 1.67,
      LastPlayedDate: now,
      Rating: null,
      DismissedFromContinueWatching: false,
    },
  });

  WatchMetadataEnrichmentService.prototype.enrichRegularMediaItems = async (_client, items) => items;

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
  assert.equal(body.data.Id, testItemId);
  assert.equal(body.data.UserData.PlaybackPositionTicks, 1_200_000_000);
  assert.equal(body.data.UserData.RuntimeTicks, 72_000_000_000);
  assert.equal(body.data.UserData.LastPlayedDate, now);
});

test('watch route requires unlock (locked profile) when profile has a PIN', async (t) => {
  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { WatchMetadataEnrichmentService } = await import('../../modules/watch/watch-metadata-enrichment.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');
  const { setProfileUnlocked, lockProfile } = await import('../../lib/profile-unlock-store.js');
  const { TEST_USER_AUTH } = await import('../../test-helpers.js');

  const originalListContinueWatching = LocalUserWatchService.prototype.listContinueWatchingPage;
  const originalEnrich = WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems;
  const originalResolve = MetadataLanguageService.prototype.resolveForProfile;

  LocalUserWatchService.prototype.listContinueWatchingPage = async function () {
    return { items: [], pageInfo: { nextCursor: null, hasMore: false } } as never;
  };
  WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems = async function () {
    return [] as never;
  };
  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en' as never;
  };
  t.after(() => {
    LocalUserWatchService.prototype.listContinueWatchingPage = originalListContinueWatching;
    WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems = originalEnrich;
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
  const { LocalUserWatchService } = await import('../../modules/integrations/local-user-watch.service.js');
  const { WatchMetadataEnrichmentService } = await import('../../modules/watch/watch-metadata-enrichment.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');

  const originalListContinueWatching = LocalUserWatchService.prototype.listContinueWatchingPage;
  const originalEnrich = WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems;
  const originalResolve = MetadataLanguageService.prototype.resolveForProfile;

  LocalUserWatchService.prototype.listContinueWatchingPage = async function () {
    return { items: [], pageInfo: { nextCursor: null, hasMore: false } } as never;
  };
  WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems = async function () {
    return [] as never;
  };
  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en' as never;
  };
  t.after(() => {
    LocalUserWatchService.prototype.listContinueWatchingPage = originalListContinueWatching;
    WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems = originalEnrich;
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
