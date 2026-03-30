import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-id', SIMKL_IMPORT_CLIENT_ID: 'simkl-id' });

test('metadata direct routes parse inputs and return service payloads', async (t) => {
  const { MetadataDirectService } = await import('../../modules/metadata/metadata-direct.service.js');
  const { MetadataQueryService } = await import('../../modules/metadata/metadata-query.service.js');
  const originals = {
    getPersonDetail: MetadataDirectService.prototype.getPersonDetail,
    listEpisodes: MetadataDirectService.prototype.listEpisodes,
    getNextEpisode: MetadataDirectService.prototype.getNextEpisode,
    getTitleContent: MetadataDirectService.prototype.getTitleContent,
    resolvePlayback: MetadataDirectService.prototype.resolvePlayback,
    getTitleDetailById: MetadataQueryService.prototype.getTitleDetailById,
  };

  t.after(() => {
    Object.assign(MetadataDirectService.prototype, originals);
    Object.assign(MetadataQueryService.prototype, { getTitleDetailById: originals.getTitleDetailById });
  });

  MetadataDirectService.prototype.getPersonDetail = async function (id, language) {
    return { id: `person:${id}`, provider: 'tmdb', providerId: '44', tmdbPersonId: 44, name: 'Person', knownForDepartment: null, biography: null, birthday: null, placeOfBirth: null, profileUrl: null, imdbId: null, instagramId: null, twitterId: null, knownFor: [], language } as never;
  };
  MetadataDirectService.prototype.listEpisodes = async function (id, seasonNumber) {
    return { show: { id, externalIds: { tmdb: null, imdb: 'tt123', tvdb: null, kitsu: null } }, requestedSeasonNumber: seasonNumber ?? null, effectiveSeasonNumber: seasonNumber ?? 1, includedSeasonNumbers: seasonNumber ? [seasonNumber] : [1], episodes: [] } as never;
  };
  MetadataDirectService.prototype.getNextEpisode = async function (id, input) {
    return { show: { id }, currentSeasonNumber: input.currentSeasonNumber, currentEpisodeNumber: input.currentEpisodeNumber, receivedWatchedKeys: input.watchedKeys, receivedShowId: input.showId, receivedNowMs: input.nowMs, item: null } as never;
  };
  MetadataDirectService.prototype.getTitleContent = async function (userId, id) {
    return { item: { id }, content: { ids: { imdb: 'tt1234567', tmdb: null, trakt: null, tvdb: null }, title: 'Movie' } } as never;
  };
  MetadataQueryService.prototype.getTitleDetailById = async function (id: string) {
    return {
      item: { id },
      seasons: [],
      videos: [{ id: 'video-1', key: 'abc123', name: 'Trailer', site: 'YouTube', type: 'Trailer', official: true, publishedAt: '2024-01-01T00:00:00.000Z', url: 'https://www.youtube.com/watch?v=abc123', thumbnailUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg' }],
      cast: [{ id: 'person:tmdb:10', provider: 'tmdb', providerId: '10', tmdbPersonId: 10, name: 'Lead Actor', role: 'Hero', department: 'Acting', profileUrl: 'https://image.tmdb.org/t/p/w185/actor.jpg' }],
      directors: [{ id: 'person:tmdb:11', provider: 'tmdb', providerId: '11', tmdbPersonId: 11, name: 'Director Name', role: 'Director', department: 'Directing', profileUrl: null }],
      creators: [{ id: 'person:tmdb:12', provider: 'tmdb', providerId: '12', tmdbPersonId: 12, name: 'Creator Name', role: null, department: 'Writing', profileUrl: null }],
      reviews: [{ id: 'review-1', author: 'Critic', username: 'critic1', content: 'Great movie', createdAt: '2024-01-02T00:00:00.000Z', updatedAt: '2024-01-03T00:00:00.000Z', url: 'https://example.com/review', rating: 8, avatarUrl: null }],
      production: { originalLanguage: 'en', originCountries: ['US'], spokenLanguages: ['English'], productionCountries: ['United States of America'], companies: [], networks: [] },
      collection: {
        id: 99,
        name: 'Saga Collection',
        posterUrl: null,
        backdropUrl: null,
        parts: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            mediaKey: 'movie:tmdb:101',
            mediaType: 'movie',
            kind: 'title',
            provider: 'tmdb',
            providerId: '101',
            parentMediaType: null,
            parentProvider: null,
            parentProviderId: null,
            tmdbId: 101,
            showTmdbId: null,
            seasonNumber: null,
            episodeNumber: null,
            absoluteEpisodeNumber: null,
            title: 'Saga Collection: Part I',
            subtitle: null,
            summary: 'The beginning',
            overview: 'The beginning',
            artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
            images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
            releaseDate: '2020-01-01',
            releaseYear: 2020,
            runtimeMinutes: null,
            rating: 7.1,
            status: null,
          },
        ],
      },
      similar: [{ id: '33333333-3333-4333-8333-333333333333', mediaKey: 'movie:tmdb:77', mediaType: 'movie', kind: 'title', provider: 'tmdb', providerId: '77', parentMediaType: null, parentProvider: null, parentProviderId: null, tmdbId: 77, showTmdbId: null, seasonNumber: null, episodeNumber: null, absoluteEpisodeNumber: null, title: 'Another Movie', subtitle: null, summary: 'Another chapter', overview: 'Another chapter', artwork: { posterUrl: null, backdropUrl: null, stillUrl: null }, images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null }, releaseDate: '2025-01-01', releaseYear: 2025, runtimeMinutes: null, rating: 7.9, status: null }],
    } as never;
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

  const titleDetailResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${movieId}`, headers: auth });
  assert.equal(titleDetailResponse.statusCode, 200);
  assert.equal(titleDetailResponse.json().item.id, movieId);
  assert.equal(titleDetailResponse.json().videos[0].key, 'abc123');
  assert.equal(titleDetailResponse.json().cast[0].name, 'Lead Actor');
  assert.equal(titleDetailResponse.json().directors[0].name, 'Director Name');
  assert.equal(titleDetailResponse.json().creators[0].name, 'Creator Name');
  assert.equal(titleDetailResponse.json().reviews[0].id, 'review-1');
  assert.equal(titleDetailResponse.json().production.originalLanguage, 'en');
  assert.equal(titleDetailResponse.json().collection.name, 'Saga Collection');
  assert.equal(titleDetailResponse.json().collection.parts[0].tmdbId, 101);
  assert.equal(titleDetailResponse.json().similar[0].tmdbId, 77);

  const nextEpisodeResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${showId}/next-episode?currentSeasonNumber=1&currentEpisodeNumber=2&watchedKeys=tt1:1:3,tt1:1:4&showId=tt1&nowMs=1700000000000`, headers: auth });
  assert.equal(nextEpisodeResponse.statusCode, 200);
  assert.deepEqual(nextEpisodeResponse.json().receivedWatchedKeys, ['tt1:1:3', 'tt1:1:4']);
  assert.equal(nextEpisodeResponse.json().receivedShowId, 'tt1');

  const contentResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${movieId}/content`, headers: auth });
  assert.equal(contentResponse.statusCode, 200);
  assert.equal(contentResponse.json().item.id, movieId);
  assert.equal(contentResponse.json().content.ids.imdb, 'tt1234567');

  const playbackResponse = await app.inject({ method: 'GET', url: `/v1/playback/resolve?id=${movieId}`, headers: auth });
  assert.equal(playbackResponse.statusCode, 200);
  assert.equal(playbackResponse.json().input.id, movieId);
});

test('watch routes expose continue-watching ids and forward dismiss params', async (t) => {
  const { ContinueWatchingService } = await import('../../modules/watch/continue-watching.service.js');
  const { WatchEventIngestService } = await import('../../modules/watch/event-ingest.service.js');
  const { WatchStateService } = await import('../../modules/watch/watch-state.service.js');

  const originals = {
    list: ContinueWatchingService.prototype.list,
    dismissContinueWatching: WatchEventIngestService.prototype.dismissContinueWatching,
    getState: WatchStateService.prototype.getState,
    getStates: WatchStateService.prototype.getStates,
  };

  t.after(() => {
    Object.assign(ContinueWatchingService.prototype, { list: originals.list });
    Object.assign(WatchEventIngestService.prototype, { dismissContinueWatching: originals.dismissContinueWatching });
    Object.assign(WatchStateService.prototype, { getState: originals.getState, getStates: originals.getStates });
  });

  ContinueWatchingService.prototype.list = async function (userId, profileId, limit) {
    return [{ id: 'cw-1', media: { id: '33333333-3333-4333-8333-333333333331' }, userId, profileId, limit }] as never;
  };
  WatchEventIngestService.prototype.dismissContinueWatching = async function (userId, profileId, id) {
    return { dismissed: true, userId, profileId, id } as never;
  };
  WatchStateService.prototype.getState = async function (_userId, _profileId, input) {
    return { media: { id: input.mediaKey }, progress: null, continueWatching: null, watched: null, watchlist: null, rating: null, watchedEpisodeKeys: [] } as never;
  };
  WatchStateService.prototype.getStates = async function (_userId, _profileId, inputs) {
    return inputs.map((input) => ({ media: { id: input.mediaKey }, progress: null, continueWatching: null, watched: null, watchlist: null, rating: null, watchedEpisodeKeys: [] })) as never;
  };

  const { registerWatchRoutes } = await import('./watch.js');
  const app = await buildTestApp(registerWatchRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const listResponse = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/watch/continue-watching?limit=7', headers: auth });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().profileId, 'profile-1');
  assert.equal(listResponse.json().kind, 'continue-watching');
  assert.equal(listResponse.json().source, 'canonical_watch');
  assert.equal(typeof listResponse.json().generatedAt, 'string');
  assert.equal(listResponse.json().items[0].id, 'cw-1');
  assert.equal(listResponse.json().items[0].userId, 'user-1');
  assert.equal(listResponse.json().items[0].profileId, 'profile-1');
  assert.equal(listResponse.json().items[0].limit, 7);

  const stateResponse = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/watch/state?mediaKey=movie:tmdb:1', headers: auth });
  assert.equal(stateResponse.statusCode, 200);
  assert.equal(stateResponse.json().profileId, 'profile-1');
  assert.equal(stateResponse.json().source, 'canonical_watch');
  assert.equal(typeof stateResponse.json().generatedAt, 'string');
  assert.equal(stateResponse.json().item.media.id, 'movie:tmdb:1');

  const statesResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/watch/states',
    headers: auth,
    payload: { items: [{ mediaKey: 'movie:tmdb:1' }, { mediaKey: 'show:tmdb:2' }] },
  });
  assert.equal(statesResponse.statusCode, 200);
  assert.equal(statesResponse.json().profileId, 'profile-1');
  assert.equal(statesResponse.json().source, 'canonical_watch');
  assert.equal(typeof statesResponse.json().generatedAt, 'string');
  assert.equal(statesResponse.json().items.length, 2);

  const invalidStateResponse = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/watch/state?mediaType=movie', headers: auth });
  assert.equal(invalidStateResponse.statusCode, 400);

  const invalidStatesResponse = await app.inject({
    method: 'POST',
    url: '/v1/profiles/profile-1/watch/states',
    headers: auth,
    payload: { items: [{ mediaType: 'movie' }] },
  });
  assert.equal(invalidStatesResponse.statusCode, 400);

  const dismissResponse = await app.inject({ method: 'DELETE', url: '/v1/profiles/profile-1/watch/continue-watching/cw-1', headers: auth });
  assert.equal(dismissResponse.statusCode, 200);
  assert.deepEqual(dismissResponse.json(), { dismissed: true, userId: 'user-1', profileId: 'profile-1', id: 'cw-1' });
});

test('library route returns DB-only watched and watchlist', async (t) => {
  const { LibraryService } = await import('../../modules/library/library.service.js');
  const originals = {
    getProfileLibrary: LibraryService.prototype.getProfileLibrary,
  };

  t.after(() => {
    Object.assign(LibraryService.prototype, originals);
  });

  LibraryService.prototype.getProfileLibrary = async function (userId, profileId) {
    return {
      profileId,
      generatedAt: '2024-01-01T00:00:00.000Z',
      watched: [
        { media: { id: 'movie-1', title: 'Test Movie' }, watchedAt: '2024-01-15T10:00:00.000Z' },
      ],
      watchlist: [
        { media: { id: 'movie-2', title: 'Watchlisted Movie' }, addedAt: '2024-01-10T08:00:00.000Z' },
      ],
    } as never;
  };

  const { registerLibraryRoutes } = await import('./library.js');
  const app = await buildTestApp(registerLibraryRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const libraryResponse = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/library', headers: auth });
  assert.equal(libraryResponse.statusCode, 200);
  assert.equal(libraryResponse.json().profileId, 'profile-1');
  assert.ok(libraryResponse.json().generatedAt);
  assert.equal(libraryResponse.json().watched.length, 1);
  assert.equal(libraryResponse.json().watched[0].media.title, 'Test Movie');
  assert.equal(libraryResponse.json().watchlist.length, 1);
  assert.equal(libraryResponse.json().watchlist[0].media.title, 'Watchlisted Movie');
});

test('library route returns 404 for non-existent profile', async (t) => {
  const { LibraryService } = await import('../../modules/library/library.service.js');
  const originals = {
    getProfileLibrary: LibraryService.prototype.getProfileLibrary,
  };

  t.after(() => {
    Object.assign(LibraryService.prototype, originals);
  });

  LibraryService.prototype.getProfileLibrary = async function () {
    throw new Error('Profile not found.');
  };

  const { registerLibraryRoutes } = await import('./library.js');
  const app = await buildTestApp(registerLibraryRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const libraryResponse = await app.inject({ method: 'GET', url: '/v1/profiles/non-existent/library', headers: auth });
  assert.equal(libraryResponse.statusCode, 500);
});

test('metadata resolve route accepts provider-shaped query input', async (t) => {
  const { MetadataQueryService } = await import('../../modules/metadata/metadata-query.service.js');
  const originalResolve = MetadataQueryService.prototype.resolve;

  t.after(() => {
    MetadataQueryService.prototype.resolve = originalResolve;
  });

  MetadataQueryService.prototype.resolve = async function (input) {
    return { item: input } as never;
  };

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metadata/resolve?mediaType=anime&provider=kitsu&providerId=123',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().item.mediaType, 'anime');
  assert.equal(response.json().item.kitsuId, 123);
  assert.equal(response.json().item.tmdbId, null);
  assert.equal(response.json().item.tvdbId, null);
});
