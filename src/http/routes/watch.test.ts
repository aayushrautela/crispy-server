import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv();

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

  MetadataLanguageService.prototype.resolveForProfile = async function () {
    return 'en-US';
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
  assert.equal(receivedAccountId, 'auth-subject');

  receivedAccountId = null;

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
  assert.equal(receivedAccountId, 'auth-subject');

  receivedAccountId = null;

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
  assert.equal(receivedAccountId, 'auth-subject');

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
      accountId: 'auth-subject',
      profileId: 'profile-1',
      mediaKey: 'movie:tmdb:1',
      titleMediaKey: 'movie:tmdb:1',
      mediaType: 'movie',
      occurredAt: '2026-05-11T10:00:00.000Z',
      kind: 'mark',
    },
    {
      accountId: 'auth-subject',
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

function makeMediaItem(key: string) {
  return {
    Id: key,
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

  const originals = {
    listContinueWatchingPage: LocalUserWatchService.prototype.listContinueWatchingPage,
    enrichContinueWatchingItems: WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems,
  };

  t.after(() => {
    LocalUserWatchService.prototype.listContinueWatchingPage = originals.listContinueWatchingPage;
    WatchMetadataEnrichmentService.prototype.enrichContinueWatchingItems = originals.enrichContinueWatchingItems;
  });

  const now = '2026-05-13T00:00:00.000Z';

  LocalUserWatchService.prototype.listContinueWatchingPage = async () => ({
    items: [
      {
        ...makeMediaItem('movie:tmdb:694'),
        UserData: {
          ItemId: 'movie:tmdb:694',
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
  assert.equal(item.Id, 'movie:tmdb:694');
  assert.equal(item.Type, 'Movie');
  assert.equal(item.UserData.PlaybackPositionTicks, 1_200_000_000);
  assert.equal(item.UserData.RuntimeTicks, 72_000_000_000);
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

  const originals = {
    getState: LocalUserWatchService.prototype.getState,
    enrichRegularMediaItems: WatchMetadataEnrichmentService.prototype.enrichRegularMediaItems,
  };

  t.after(() => {
    LocalUserWatchService.prototype.getState = originals.getState;
    WatchMetadataEnrichmentService.prototype.enrichRegularMediaItems = originals.enrichRegularMediaItems;
  });

  const now = '2026-05-13T00:00:00.000Z';
  const progress = {
    positionSeconds: 120,
    durationSeconds: 7200,
    progressPercent: 1.67,
    lastPlayedAt: now,
  };

  LocalUserWatchService.prototype.getState = async () => ({
    ...makeMediaItem('movie:tmdb:694'),
    UserData: {
      ItemId: 'movie:tmdb:694',
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

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/state?mediaKey=movie:tmdb:694',
    headers: { authorization: 'Bearer test' },
  });

  const body = response.json();
  assert.equal(response.statusCode, 200, JSON.stringify(body, null, 2));
  assert.equal(body.data.Id, 'movie:tmdb:694');
  assert.equal(body.data.UserData.PlaybackPositionTicks, 1_200_000_000);
  assert.equal(body.data.UserData.RuntimeTicks, 72_000_000_000);
  assert.equal(body.data.UserData.LastPlayedDate, now);
});
