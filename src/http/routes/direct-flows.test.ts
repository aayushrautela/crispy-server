import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

seedTestEnv();

async function buildRouteTestApp(register: (app: Awaited<ReturnType<typeof Fastify>>) => Promise<void>) {
  seedTestEnv();
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');

  const app = Fastify();
  app.decorateRequest('auth');
  app.decorate('requireAuth', async (request: FastifyRequest) => {
    request.auth = {
      type: 'user',
      appUserId: 'user-1',
      serviceId: null,
      scopes: [],
      authSubject: 'auth-subject',
      email: 'test@example.com',
      tokenId: null,
      consumerId: null,
    };
  });
  app.decorate('requireServiceAuth', async () => {});
  app.decorate('requireUserActor', (request: FastifyRequest) => request.auth as never);
  app.decorate('requireScopes', () => {});
  await app.register(errorHandlerPlugin);
  await register(app);
  return app;
}

test('metadata direct routes parse inputs and return service payloads', async (t) => {
  const { MetadataDirectService } = await import('../../modules/metadata/metadata-direct.service.js');
  const originalGetPersonDetail = MetadataDirectService.prototype.getPersonDetail;
  const originalListEpisodes = MetadataDirectService.prototype.listEpisodes;
  const originalGetNextEpisode = MetadataDirectService.prototype.getNextEpisode;
  const originalGetTitleContent = MetadataDirectService.prototype.getTitleContent;
  const originalResolvePlayback = MetadataDirectService.prototype.resolvePlayback;

  t.after(() => {
    MetadataDirectService.prototype.getPersonDetail = originalGetPersonDetail;
    MetadataDirectService.prototype.listEpisodes = originalListEpisodes;
    MetadataDirectService.prototype.getNextEpisode = originalGetNextEpisode;
    MetadataDirectService.prototype.getTitleContent = originalGetTitleContent;
    MetadataDirectService.prototype.resolvePlayback = originalResolvePlayback;
  });

  MetadataDirectService.prototype.getPersonDetail = async function (id, language) {
    return {
      id: `person:${id}`,
      tmdbPersonId: 44,
      name: 'Person',
      knownForDepartment: null,
      biography: null,
      birthday: null,
      placeOfBirth: null,
      profileUrl: null,
      imdbId: null,
      instagramId: null,
      twitterId: null,
      knownFor: [],
      language,
    } as never;
  };

  MetadataDirectService.prototype.listEpisodes = async function (id, seasonNumber) {
    return {
      show: { id, externalIds: { imdb: 'tt123' } },
      requestedSeasonNumber: seasonNumber ?? null,
      effectiveSeasonNumber: seasonNumber ?? 1,
      includedSeasonNumbers: seasonNumber ? [seasonNumber] : [1],
      episodes: [],
    } as never;
  };

  MetadataDirectService.prototype.getNextEpisode = async function (id, input) {
    return {
      show: { id },
      currentSeasonNumber: input.currentSeasonNumber,
      currentEpisodeNumber: input.currentEpisodeNumber,
      receivedWatchedKeys: input.watchedKeys,
      receivedShowId: input.showId,
      receivedNowMs: input.nowMs,
      item: null,
    } as never;
  };

  MetadataDirectService.prototype.getTitleContent = async function (userId, id) {
    return {
      item: { id },
      omdb: {
        imdbId: 'tt1234567',
        title: 'Movie',
        userId,
      },
    } as never;
  };

  MetadataDirectService.prototype.resolvePlayback = async function (input) {
    return {
      item: { id: input.id ?? 'fallback' },
      show: null,
      season: null,
      input,
    } as never;
  };

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildRouteTestApp(registerMetadataRoutes);
  t.after(async () => {
    await app.close();
  });

  const personResponse = await app.inject({
    method: 'GET',
    url: '/v1/metadata/people/44?language=en-US',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(personResponse.statusCode, 200);
  assert.equal(personResponse.json().language, 'en-US');

  const episodesResponse = await app.inject({
    method: 'GET',
    url: '/v1/metadata/titles/crisp:show:12/episodes?seasonNumber=2',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(episodesResponse.statusCode, 200);
  assert.equal(episodesResponse.json().requestedSeasonNumber, 2);

  const nextEpisodeResponse = await app.inject({
    method: 'GET',
    url: '/v1/metadata/titles/crisp:show:12/next-episode?currentSeasonNumber=1&currentEpisodeNumber=2&watchedKeys=tt1:1:3,tt1:1:4&showId=tt1&nowMs=1700000000000',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(nextEpisodeResponse.statusCode, 200);
  assert.deepEqual(nextEpisodeResponse.json().receivedWatchedKeys, ['tt1:1:3', 'tt1:1:4']);
  assert.equal(nextEpisodeResponse.json().receivedShowId, 'tt1');
  assert.equal(nextEpisodeResponse.json().receivedNowMs, 1700000000000);

  const contentResponse = await app.inject({
    method: 'GET',
    url: '/v1/metadata/titles/crisp:movie:55/content',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(contentResponse.statusCode, 200);
  assert.equal(contentResponse.json().item.id, 'crisp:movie:55');
  assert.equal(contentResponse.json().omdb.userId, 'user-1');

  const playbackResponse = await app.inject({
    method: 'GET',
    url: '/v1/playback/resolve?id=crisp:movie:55',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(playbackResponse.statusCode, 200);
  assert.equal(playbackResponse.json().input.id, 'crisp:movie:55');
});

test('account routes expose AI endpoint metadata and AI API key aliases', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const { ProfileService } = await import('../../modules/profiles/profile.service.js');

  const originalGetSettings = AccountSettingsService.prototype.getSettings;
  const originalGetAiApiKeyForUser = AccountSettingsService.prototype.getAiApiKeyForUser;
  const originalSetAiApiKeyForUser = AccountSettingsService.prototype.setAiApiKeyForUser;
  const originalClearAiApiKeyForUser = AccountSettingsService.prototype.clearAiApiKeyForUser;
  const originalGetOmdbApiKeyForUser = AccountSettingsService.prototype.getOmdbApiKeyForUser;
  const originalListForAccount = ProfileService.prototype.listForAccount;

  t.after(() => {
    AccountSettingsService.prototype.getSettings = originalGetSettings;
    AccountSettingsService.prototype.getAiApiKeyForUser = originalGetAiApiKeyForUser;
    AccountSettingsService.prototype.setAiApiKeyForUser = originalSetAiApiKeyForUser;
    AccountSettingsService.prototype.clearAiApiKeyForUser = originalClearAiApiKeyForUser;
    AccountSettingsService.prototype.getOmdbApiKeyForUser = originalGetOmdbApiKeyForUser;
    ProfileService.prototype.listForAccount = originalListForAccount;
  });

  AccountSettingsService.prototype.getSettings = async function () {
    return { addons: { trakt: true } } as never;
  };
  AccountSettingsService.prototype.getAiApiKeyForUser = async function (userId) {
    return { appUserId: userId, key: 'ai.api_key', value: 'ai-key' } as never;
  };
  AccountSettingsService.prototype.setAiApiKeyForUser = async function (userId, value) {
    return { appUserId: userId, key: 'ai.api_key', value } as never;
  };
  AccountSettingsService.prototype.clearAiApiKeyForUser = async function () {
    return true;
  };
  AccountSettingsService.prototype.getOmdbApiKeyForUser = async function (userId) {
    return { appUserId: userId, key: 'metadata.omdb_api_key', value: 'omdb-key' } as never;
  };
  ProfileService.prototype.listForAccount = async function () {
    return [] as never;
  };

  const { registerAccountRoutes } = await import('./account.js');
  const { registerMeRoutes } = await import('./me.js');
  const accountApp = await buildRouteTestApp(registerAccountRoutes);
  const meApp = await buildRouteTestApp(registerMeRoutes);

  t.after(async () => {
    await accountApp.close();
    await meApp.close();
  });

  const settingsResponse = await accountApp.inject({
    method: 'GET',
    url: '/v1/account/settings',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(settingsResponse.statusCode, 200);
  assert.equal(settingsResponse.json().settings.ai.hasAiApiKey, true);
  assert.equal(settingsResponse.json().settings.ai.endpointUrl, 'https://api.openai.com/v1/chat/completions');

  const aiSecretResponse = await accountApp.inject({
    method: 'GET',
    url: '/v1/account/secrets/ai-api-key',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(aiSecretResponse.statusCode, 200);
  assert.equal(aiSecretResponse.json().secret.value, 'ai-key');
  assert.equal(aiSecretResponse.json().secret.key, 'ai.api_key');

  const meResponse = await meApp.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.json().accountSettings.ai.endpointUrl, 'https://api.openai.com/v1/chat/completions');
});

test('watch routes expose continue-watching ids and forward dismiss params', async (t) => {
  const { ContinueWatchingService } = await import('../../modules/watch/continue-watching.service.js');
  const { WatchEventIngestService } = await import('../../modules/watch/event-ingest.service.js');

  const originalList = ContinueWatchingService.prototype.list;
  const originalDismissContinueWatching = WatchEventIngestService.prototype.dismissContinueWatching;

  t.after(() => {
    ContinueWatchingService.prototype.list = originalList;
    WatchEventIngestService.prototype.dismissContinueWatching = originalDismissContinueWatching;
  });

  ContinueWatchingService.prototype.list = async function (userId, profileId, limit) {
    return [{ id: 'cw-1', media: { id: 'crisp:movie:1' }, userId, profileId, limit }] as never;
  };

  WatchEventIngestService.prototype.dismissContinueWatching = async function (userId, profileId, id) {
    return { dismissed: true, userId, profileId, id } as never;
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildRouteTestApp(registerWatchRoutes);
  t.after(async () => {
    await app.close();
  });

  const listResponse = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/watch/continue-watching?limit=7',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().items[0].id, 'cw-1');
  assert.equal(listResponse.json().items[0].userId, 'user-1');
  assert.equal(listResponse.json().items[0].profileId, 'profile-1');
  assert.equal(listResponse.json().items[0].limit, 7);

  const dismissResponse = await app.inject({
    method: 'DELETE',
    url: '/v1/profiles/profile-1/watch/continue-watching/cw-1',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(dismissResponse.statusCode, 200);
  assert.deepEqual(dismissResponse.json(), {
    dismissed: true,
    userId: 'user-1',
    profileId: 'profile-1',
    id: 'cw-1',
  });
});

test('library routes forward source and limit to service', async (t) => {
  const { LibraryService } = await import('../../modules/library/library.service.js');
  const originalGetProfileLibrary = LibraryService.prototype.getProfileLibrary;
  const originalRequireOwnedProfile = LibraryService.prototype.requireOwnedProfile;
  const originalGetProviderAuthState = LibraryService.prototype.getProviderAuthState;
  const originalSetWatchlist = LibraryService.prototype.setWatchlist;
  const originalSetRating = LibraryService.prototype.setRating;

  t.after(() => {
    LibraryService.prototype.getProfileLibrary = originalGetProfileLibrary;
    LibraryService.prototype.requireOwnedProfile = originalRequireOwnedProfile;
    LibraryService.prototype.getProviderAuthState = originalGetProviderAuthState;
    LibraryService.prototype.setWatchlist = originalSetWatchlist;
    LibraryService.prototype.setRating = originalSetRating;
  });

  LibraryService.prototype.getProfileLibrary = async function (userId, profileId, options) {
    return {
      userId,
      profileId,
      source: options?.source ?? 'all',
      limitPerFolder: options?.limitPerFolder ?? null,
      auth: { providers: [] },
      native: null,
      providers: [],
    } as never;
  };

  LibraryService.prototype.requireOwnedProfile = async function () {};
  LibraryService.prototype.getProviderAuthState = async function (_accountId, profileId) {
    return [{ provider: 'trakt', connected: true, status: 'connected', tokenState: 'valid', externalUsername: profileId, lastImportCompletedAt: null, lastUsedAt: null, message: null }] as never;
  };
  LibraryService.prototype.setWatchlist = async function (_userId, _profileId, input) {
    return {
      source: input.source ?? 'all',
      action: 'watchlist',
      watchlist: input.inWatchlist,
      rating: null,
      media: { id: input.id ?? input.imdbId ?? 'fallback' },
      results: [],
      statusMessage: 'Saved to watchlist.',
      input,
    } as never;
  };
  LibraryService.prototype.setRating = async function (_userId, _profileId, input) {
    return {
      source: input.source ?? 'all',
      action: 'rating',
      watchlist: null,
      rating: input.rating,
      media: { id: input.id ?? input.imdbId ?? 'fallback' },
      results: [],
      statusMessage: 'Rated 8/10.',
      input,
    } as never;
  };

  const { registerLibraryRoutes } = await import('./library.js');
  const app = await buildRouteTestApp(registerLibraryRoutes);
  t.after(async () => {
    await app.close();
  });

  const libraryResponse = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/library?source=trakt&limitPerFolder=25',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(libraryResponse.statusCode, 200);
  assert.equal(libraryResponse.json().userId, 'user-1');
  assert.equal(libraryResponse.json().source, 'trakt');
  assert.equal(libraryResponse.json().limitPerFolder, 25);

  const authStateResponse = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/provider-auth/state',
    headers: { authorization: 'Bearer test' },
  });
  assert.equal(authStateResponse.statusCode, 200);
  assert.equal(authStateResponse.json().providers[0].externalUsername, 'profile-1');

  const watchlistResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/library/watchlist',
    headers: { authorization: 'Bearer test' },
    payload: {
      source: 'simkl',
      inWatchlist: true,
      imdbId: 'tt1234567',
      mediaType: 'movie',
    },
  });
  assert.equal(watchlistResponse.statusCode, 200);
  assert.equal(watchlistResponse.json().source, 'simkl');
  assert.equal(watchlistResponse.json().input.imdbId, 'tt1234567');
  assert.equal(watchlistResponse.json().input.inWatchlist, true);

  const ratingResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/library/rating',
    headers: { authorization: 'Bearer test' },
    payload: {
      source: 'trakt',
      rating: 8,
      id: 'crisp:movie:12',
    },
  });
  assert.equal(ratingResponse.statusCode, 200);
  assert.equal(ratingResponse.json().source, 'trakt');
  assert.equal(ratingResponse.json().input.id, 'crisp:movie:12');
  assert.equal(ratingResponse.json().input.rating, 8);
});

test('library route rejects invalid source', async (t) => {
  await import('../../modules/library/library.service.js');
  const { registerLibraryRoutes } = await import('./library.js');
  const app = await buildRouteTestApp(registerLibraryRoutes);
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/profiles/profile-1/library?source=bad',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    error: 'Invalid library source.',
  });
});
