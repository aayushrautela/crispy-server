import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv();

test('watch routes require user session actor with access token', async (t) => {
  const { SupabaseUserWatchService } = await import('../../modules/integrations/supabase-user-watch.service.js');
  const { WatchSupabaseEnrichmentService } = await import('../../modules/watch/watch-supabase-enrichment.service.js');
   
  const originals = {
    listContinueWatchingPage: SupabaseUserWatchService.prototype.listContinueWatchingPage,
    recordPlaybackState: SupabaseUserWatchService.prototype.recordPlaybackState,
    markWatched: SupabaseUserWatchService.prototype.markWatched,
    unmarkWatched: SupabaseUserWatchService.prototype.unmarkWatched,
    enrichContinueWatchingItems: WatchSupabaseEnrichmentService.prototype.enrichContinueWatchingItems,
  };
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');
  const originalResolveForProfile = MetadataLanguageService.prototype.resolveForProfile;

  t.after(() => {
    SupabaseUserWatchService.prototype.listContinueWatchingPage = originals.listContinueWatchingPage;
    SupabaseUserWatchService.prototype.recordPlaybackState = originals.recordPlaybackState;
    SupabaseUserWatchService.prototype.markWatched = originals.markWatched;
    SupabaseUserWatchService.prototype.unmarkWatched = originals.unmarkWatched;
    WatchSupabaseEnrichmentService.prototype.enrichContinueWatchingItems = originals.enrichContinueWatchingItems;
    MetadataLanguageService.prototype.resolveForProfile = originalResolveForProfile;
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

  WatchSupabaseEnrichmentService.prototype.enrichContinueWatchingItems = async function (_client, items) {
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

function makeMediaItem(key: string) {
  return {
    mediaKey: key,
    mediaType: 'movie' as const,
    title: 'Test Movie',
    originalTitle: null,
    subtitle: null,
    overview: null,
    images: {
      poster: { small: null, medium: null, large: null },
      backdrop: { small: null, medium: null, large: null },
      still: { small: null, medium: null, large: null },
      logo: { small: null, medium: null, large: null },
    },
    releaseDate: null,
    releaseYear: null,
    rating: null,
    genres: [],
    runtimeMinutes: null,
    status: null,
    maturityRating: null,
    certification: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    externalIds: { tmdb: 694, imdb: null, tvdb: null },
    parent: null,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    episodeTitle: null,
    airDate: null,
    badges: [],
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

  const { SupabaseUserWatchService } = await import('../../modules/integrations/supabase-user-watch.service.js');
  const { WatchSupabaseEnrichmentService } = await import('../../modules/watch/watch-supabase-enrichment.service.js');

  const originals = {
    listContinueWatchingPage: SupabaseUserWatchService.prototype.listContinueWatchingPage,
    enrichContinueWatchingItems: WatchSupabaseEnrichmentService.prototype.enrichContinueWatchingItems,
  };

  t.after(() => {
    SupabaseUserWatchService.prototype.listContinueWatchingPage = originals.listContinueWatchingPage;
    WatchSupabaseEnrichmentService.prototype.enrichContinueWatchingItems = originals.enrichContinueWatchingItems;
  });

  const now = '2026-05-13T00:00:00.000Z';

  SupabaseUserWatchService.prototype.listContinueWatchingPage = async () => ({
    items: [
      {
        id: 'movie:tmdb:694',
        kind: 'continue_watching',
        mediaItem: makeMediaItem('movie:tmdb:694'),
        context: {
          id: 'movie:tmdb:694',
          progress: {
            positionSeconds: 120,
            durationSeconds: 7200,
            progressPercent: 1.67,
            lastPlayedAt: now,
          },
          lastActivityAt: now,
          origins: ['test'],
          dismissible: true,
        },
        presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
        progress: {
          positionSeconds: 120,
          durationSeconds: 7200,
          progressPercent: 1.67,
          lastPlayedAt: now,
        },
        lastActivityAt: now,
        origins: ['test'],
        dismissible: true,
      },
    ],
    pageInfo: { nextCursor: null, hasMore: false },
  });

  WatchSupabaseEnrichmentService.prototype.enrichContinueWatchingItems = async (_client, items) => items;

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
  assert.ok(Array.isArray(body.data.items));
  assert.equal(body.data.items.length, 1);
  const item = body.data.items[0];
  assert.equal(item.id, 'movie:tmdb:694');
  assert.equal(item.kind, 'continue_watching');
  assert.ok(item.progress);
  assert.equal(item.progress.positionSeconds, 120);
  assert.equal(item.progress.durationSeconds, 7200);
  assert.equal(item.progress.progressPercent, 1.67);
  assert.equal(item.progress.lastPlayedAt, now);
  assert.equal(item.context.progress.lastPlayedAt, now);
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

  const { SupabaseUserWatchService } = await import('../../modules/integrations/supabase-user-watch.service.js');
  const { WatchSupabaseEnrichmentService } = await import('../../modules/watch/watch-supabase-enrichment.service.js');

  const originals = {
    getState: SupabaseUserWatchService.prototype.getState,
    enrichRegularMediaItems: WatchSupabaseEnrichmentService.prototype.enrichRegularMediaItems,
  };

  t.after(() => {
    SupabaseUserWatchService.prototype.getState = originals.getState;
    WatchSupabaseEnrichmentService.prototype.enrichRegularMediaItems = originals.enrichRegularMediaItems;
  });

  const now = '2026-05-13T00:00:00.000Z';
  const progress = {
    positionSeconds: 120,
    durationSeconds: 7200,
    progressPercent: 1.67,
    lastPlayedAt: now,
  };

  SupabaseUserWatchService.prototype.getState = async () => ({
    kind: 'watch_state',
    mediaItem: makeMediaItem('movie:tmdb:694'),
    context: {
      progress,
      continueWatching: null,
      watched: null,
      watchlist: null,
      rating: null,
      watchedEpisodeKeys: [],
      playCount: 0,
    },
    presentation: null,
    progress,
    continueWatching: null,
    watched: null,
    watchlist: null,
    rating: null,
    watchedEpisodeKeys: [],
    playCount: 0,
  });

  WatchSupabaseEnrichmentService.prototype.enrichRegularMediaItems = async (_client, items) => items;

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
  assert.equal(body.data.item.kind, 'watch_state');
  assert.deepEqual(body.data.item.progress, progress);
  assert.deepEqual(body.data.item.context.progress, progress);
});
