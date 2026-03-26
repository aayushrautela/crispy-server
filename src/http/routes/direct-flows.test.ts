import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-id', SIMKL_IMPORT_CLIENT_ID: 'simkl-id' });

test('metadata direct routes parse inputs and return service payloads', async (t) => {
  const { MetadataDirectService } = await import('../../modules/metadata/metadata-direct.service.js');
  const originals = {
    getPersonDetail: MetadataDirectService.prototype.getPersonDetail,
    listEpisodes: MetadataDirectService.prototype.listEpisodes,
    getNextEpisode: MetadataDirectService.prototype.getNextEpisode,
    getTitleContent: MetadataDirectService.prototype.getTitleContent,
    resolvePlayback: MetadataDirectService.prototype.resolvePlayback,
  };

  t.after(() => {
    Object.assign(MetadataDirectService.prototype, originals);
  });

  MetadataDirectService.prototype.getPersonDetail = async function (id, language) {
    return { id: `person:${id}`, tmdbPersonId: 44, name: 'Person', knownForDepartment: null, biography: null, birthday: null, placeOfBirth: null, profileUrl: null, imdbId: null, instagramId: null, twitterId: null, knownFor: [], language } as never;
  };
  MetadataDirectService.prototype.listEpisodes = async function (id, seasonNumber) {
    return { show: { id, externalIds: { imdb: 'tt123' } }, requestedSeasonNumber: seasonNumber ?? null, effectiveSeasonNumber: seasonNumber ?? 1, includedSeasonNumbers: seasonNumber ? [seasonNumber] : [1], episodes: [] } as never;
  };
  MetadataDirectService.prototype.getNextEpisode = async function (id, input) {
    return { show: { id }, currentSeasonNumber: input.currentSeasonNumber, currentEpisodeNumber: input.currentEpisodeNumber, receivedWatchedKeys: input.watchedKeys, receivedShowId: input.showId, receivedNowMs: input.nowMs, item: null } as never;
  };
  MetadataDirectService.prototype.getTitleContent = async function (userId, id) {
    return { item: { id }, omdb: { imdbId: 'tt1234567', title: 'Movie', userId } } as never;
  };
  MetadataDirectService.prototype.resolvePlayback = async function (input) {
    return { item: { id: input.id ?? 'fallback' }, show: null, season: null, input } as never;
  };

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const personResponse = await app.inject({ method: 'GET', url: '/v1/metadata/people/44?language=en-US', headers: auth });
  assert.equal(personResponse.statusCode, 200);
  assert.equal(personResponse.json().language, 'en-US');

  const showId = '11111111-1111-4111-8111-111111111112';
  const movieId = '22222222-2222-4222-8222-222222222255';

  const episodesResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${showId}/episodes?seasonNumber=2`, headers: auth });
  assert.equal(episodesResponse.statusCode, 200);
  assert.equal(episodesResponse.json().requestedSeasonNumber, 2);

  const nextEpisodeResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${showId}/next-episode?currentSeasonNumber=1&currentEpisodeNumber=2&watchedKeys=tt1:1:3,tt1:1:4&showId=tt1&nowMs=1700000000000`, headers: auth });
  assert.equal(nextEpisodeResponse.statusCode, 200);
  assert.deepEqual(nextEpisodeResponse.json().receivedWatchedKeys, ['tt1:1:3', 'tt1:1:4']);
  assert.equal(nextEpisodeResponse.json().receivedShowId, 'tt1');

  const contentResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${movieId}/content`, headers: auth });
  assert.equal(contentResponse.statusCode, 200);
  assert.equal(contentResponse.json().item.id, movieId);
  assert.equal(contentResponse.json().omdb.userId, 'user-1');

  const playbackResponse = await app.inject({ method: 'GET', url: `/v1/playback/resolve?id=${movieId}`, headers: auth });
  assert.equal(playbackResponse.statusCode, 200);
  assert.equal(playbackResponse.json().input.id, movieId);
});

test('watch routes expose continue-watching ids and forward dismiss params', async (t) => {
  const { ContinueWatchingService } = await import('../../modules/watch/continue-watching.service.js');
  const { WatchEventIngestService } = await import('../../modules/watch/event-ingest.service.js');

  const originals = {
    list: ContinueWatchingService.prototype.list,
    dismissContinueWatching: WatchEventIngestService.prototype.dismissContinueWatching,
  };

  t.after(() => {
    Object.assign(ContinueWatchingService.prototype, { list: originals.list });
    Object.assign(WatchEventIngestService.prototype, { dismissContinueWatching: originals.dismissContinueWatching });
  });

  ContinueWatchingService.prototype.list = async function (userId, profileId, limit) {
    return [{ id: 'cw-1', media: { id: '33333333-3333-4333-8333-333333333331' }, userId, profileId, limit }] as never;
  };
  WatchEventIngestService.prototype.dismissContinueWatching = async function (userId, profileId, id) {
    return { dismissed: true, userId, profileId, id } as never;
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const listResponse = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/watch/continue-watching?limit=7', headers: auth });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().items[0].id, 'cw-1');
  assert.equal(listResponse.json().items[0].userId, 'user-1');
  assert.equal(listResponse.json().items[0].profileId, 'profile-1');
  assert.equal(listResponse.json().items[0].limit, 7);

  const dismissResponse = await app.inject({ method: 'DELETE', url: '/v1/profiles/profile-1/watch/continue-watching/cw-1', headers: auth });
  assert.equal(dismissResponse.statusCode, 200);
  assert.deepEqual(dismissResponse.json(), { dismissed: true, userId: 'user-1', profileId: 'profile-1', id: 'cw-1' });
});

test('library routes forward source and limit to service', async (t) => {
  const { LibraryService } = await import('../../modules/library/library.service.js');
  const originals = {
    getProfileLibrary: LibraryService.prototype.getProfileLibrary,
    requireOwnedProfile: LibraryService.prototype.requireOwnedProfile,
    getProviderAuthState: LibraryService.prototype.getProviderAuthState,
    setWatchlist: LibraryService.prototype.setWatchlist,
    setRating: LibraryService.prototype.setRating,
  };

  t.after(() => {
    Object.assign(LibraryService.prototype, originals);
  });

  LibraryService.prototype.getProfileLibrary = async function (userId, profileId, options) {
    return { userId, profileId, source: options?.source ?? 'all', limitPerFolder: options?.limitPerFolder ?? null, auth: { providers: [] }, native: null, providers: [] } as never;
  };
  LibraryService.prototype.requireOwnedProfile = async function () {};
  LibraryService.prototype.getProviderAuthState = async function (_accountId, profileId) {
    return [{ provider: 'trakt', connected: true, status: 'connected', tokenState: 'valid', externalUsername: profileId, lastImportCompletedAt: null, lastUsedAt: null, message: null }] as never;
  };
  LibraryService.prototype.setWatchlist = async function (_userId, _profileId, input) {
    return { source: input.source ?? 'all', action: 'watchlist', watchlist: input.inWatchlist, rating: null, media: { id: input.id ?? input.imdbId ?? 'fallback' }, results: [], statusMessage: 'Saved to watchlist.', input } as never;
  };
  LibraryService.prototype.setRating = async function (_userId, _profileId, input) {
    return { source: input.source ?? 'all', action: 'rating', watchlist: null, rating: input.rating, media: { id: input.id ?? input.imdbId ?? 'fallback' }, results: [], statusMessage: 'Rated 8/10.', input } as never;
  };

  const { registerLibraryRoutes } = await import('./library.js');
  const app = await buildTestApp(registerLibraryRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const libraryResponse = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/library?source=trakt&limitPerFolder=25', headers: auth });
  assert.equal(libraryResponse.statusCode, 200);
  assert.equal(libraryResponse.json().userId, 'user-1');
  assert.equal(libraryResponse.json().source, 'trakt');
  assert.equal(libraryResponse.json().limitPerFolder, 25);

  const authStateResponse = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/provider-auth/state', headers: auth });
  assert.equal(authStateResponse.statusCode, 200);
  assert.equal(authStateResponse.json().providers[0].externalUsername, 'profile-1');

  const watchlistResponse = await app.inject({
    method: 'POST', url: '/v1/profiles/profile-1/library/watchlist', headers: auth,
    payload: { source: 'simkl', inWatchlist: true, imdbId: 'tt1234567', mediaType: 'movie' },
  });
  assert.equal(watchlistResponse.statusCode, 200);
  assert.equal(watchlistResponse.json().source, 'simkl');
  assert.equal(watchlistResponse.json().input.imdbId, 'tt1234567');

  const ratingResponse = await app.inject({
    method: 'POST', url: '/v1/profiles/profile-1/library/rating', headers: auth,
    payload: { source: 'trakt', rating: 8, id: '44444444-4444-4444-8444-444444444412' },
  });
  assert.equal(ratingResponse.statusCode, 200);
  assert.equal(ratingResponse.json().source, 'trakt');
  assert.equal(ratingResponse.json().input.rating, 8);
});

test('library route rejects invalid source', async (t) => {
  const { registerLibraryRoutes } = await import('./library.js');
  const app = await buildTestApp(registerLibraryRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/library?source=bad', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'Invalid library source.' });
});
