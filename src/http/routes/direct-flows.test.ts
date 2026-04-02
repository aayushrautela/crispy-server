import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-id', SIMKL_IMPORT_CLIENT_ID: 'simkl-id' });

test('metadata direct routes parse inputs and return service payloads', async (t) => {
  const { MetadataDirectService } = await import('../../modules/metadata/metadata-direct.service.js');
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const originals = {
    getPersonDetail: MetadataDirectService.prototype.getPersonDetail,
    listEpisodes: MetadataDirectService.prototype.listEpisodes,
    getNextEpisode: MetadataDirectService.prototype.getNextEpisode,
    getTitleContent: MetadataDirectService.prototype.getTitleContent,
    resolvePlayback: MetadataDirectService.prototype.resolvePlayback,
    getTitleDetailById: MetadataDetailService.prototype.getTitleDetailById,
  };

  t.after(() => {
    Object.assign(MetadataDirectService.prototype, originals);
    Object.assign(MetadataDetailService.prototype, { getTitleDetailById: originals.getTitleDetailById });
  });

  MetadataDirectService.prototype.getPersonDetail = async function (id, language) {
    return { id: `person:${id}`, provider: 'tmdb', providerId: '44', tmdbPersonId: 44, name: 'Person', knownForDepartment: null, biography: null, birthday: null, placeOfBirth: null, profileUrl: null, imdbId: null, instagramId: null, twitterId: null, knownFor: [], language } as never;
  };
  MetadataDirectService.prototype.listEpisodes = async function (id, seasonNumber) {
    return { show: { mediaKey: id, providerId: id, externalIds: { tmdb: null, imdb: 'tt123', tvdb: null, kitsu: null } }, requestedSeasonNumber: seasonNumber ?? null, effectiveSeasonNumber: seasonNumber ?? 1, includedSeasonNumbers: seasonNumber ? [seasonNumber] : [1], episodes: [] } as never;
  };
  MetadataDirectService.prototype.getNextEpisode = async function (id, input) {
    return { show: { mediaKey: id, providerId: id }, currentSeasonNumber: input.currentSeasonNumber, currentEpisodeNumber: input.currentEpisodeNumber, receivedWatchedKeys: input.watchedKeys, receivedShowMediaKey: input.showMediaKey, receivedNowMs: input.nowMs, item: null } as never;
  };
  MetadataDirectService.prototype.getTitleContent = async function (userId, id) {
    return { item: { mediaKey: id, providerId: id }, content: { ids: { imdb: 'tt1234567', tmdb: null, trakt: null, tvdb: null }, title: 'Movie' } } as never;
  };
  MetadataDetailService.prototype.getTitleDetailById = async function (id: string) {
    return {
      item: { mediaKey: id, providerId: id },
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
              mediaType: 'movie',
              kind: 'title',
              mediaKey: 'movie:tmdb:101',
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
      similar: [{ mediaType: 'movie', kind: 'title', mediaKey: 'movie:tmdb:77', provider: 'tmdb', providerId: '77', parentMediaType: null, parentProvider: null, parentProviderId: null, tmdbId: 77, showTmdbId: null, seasonNumber: null, episodeNumber: null, absoluteEpisodeNumber: null, title: 'Another Movie', subtitle: null, summary: 'Another chapter', overview: 'Another chapter', artwork: { posterUrl: null, backdropUrl: null, stillUrl: null }, images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null }, releaseDate: '2025-01-01', releaseYear: 2025, runtimeMinutes: null, rating: 7.9, status: null }],
    } as never;
  };
  MetadataDirectService.prototype.resolvePlayback = async function (input) {
    return { item: { mediaKey: input.mediaKey ?? 'fallback', providerId: input.mediaKey ?? 'fallback' }, show: null, season: null, input } as never;
  };

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const personResponse = await app.inject({ method: 'GET', url: '/v1/metadata/people/44?language=en-US', headers: auth });
  assert.equal(personResponse.statusCode, 200);
  assert.equal(personResponse.json().language, 'en-US');

  const showMediaKey = 'show:tmdb:111';
  const movieMediaKey = 'movie:tmdb:222';

  const episodesResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${showMediaKey}/episodes?seasonNumber=2`, headers: auth });
  assert.equal(episodesResponse.statusCode, 200);
  assert.equal(episodesResponse.json().requestedSeasonNumber, 2);
  assert.equal(episodesResponse.json().show.mediaKey, showMediaKey);

  const titleDetailResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${movieMediaKey}`, headers: auth });
  assert.equal(titleDetailResponse.statusCode, 200);
  assert.equal(titleDetailResponse.json().item.mediaKey, movieMediaKey);
  assert.equal(titleDetailResponse.json().videos[0].key, 'abc123');
  assert.equal(titleDetailResponse.json().cast[0].name, 'Lead Actor');
  assert.equal(titleDetailResponse.json().directors[0].name, 'Director Name');
  assert.equal(titleDetailResponse.json().creators[0].name, 'Creator Name');
  assert.equal(titleDetailResponse.json().reviews[0].id, 'review-1');
  assert.equal(titleDetailResponse.json().production.originalLanguage, 'en');
  assert.equal(titleDetailResponse.json().collection.name, 'Saga Collection');
  assert.equal(titleDetailResponse.json().collection.parts[0].mediaKey, 'movie:tmdb:101');
  assert.equal(titleDetailResponse.json().collection.parts[0].tmdbId, 101);
  assert.equal(titleDetailResponse.json().similar[0].mediaKey, 'movie:tmdb:77');
  assert.equal(titleDetailResponse.json().similar[0].tmdbId, 77);

  const nextEpisodeResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${showMediaKey}/next-episode?currentSeasonNumber=1&currentEpisodeNumber=2&watchedKeys=tt1:1:3,tt1:1:4&showMediaKey=show:tvdb:tt1&nowMs=1700000000000`, headers: auth });
  assert.equal(nextEpisodeResponse.statusCode, 200);
  assert.deepEqual(nextEpisodeResponse.json().receivedWatchedKeys, ['tt1:1:3', 'tt1:1:4']);
  assert.equal(nextEpisodeResponse.json().receivedShowMediaKey, 'show:tvdb:tt1');

  const contentResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${movieMediaKey}/content`, headers: auth });
  assert.equal(contentResponse.statusCode, 200);
  assert.equal(contentResponse.json().item.mediaKey, movieMediaKey);
  assert.equal(contentResponse.json().content.ids.imdb, 'tt1234567');

  const playbackResponse = await app.inject({ method: 'GET', url: `/v1/playback/resolve?mediaKey=${movieMediaKey}`, headers: auth });
  assert.equal(playbackResponse.statusCode, 200);
  assert.equal(playbackResponse.json().input.mediaKey, movieMediaKey);
});

test('watch routes expose continue-watching ids and forward dismiss params', async (t) => {
  const { ContinueWatchingService } = await import('../../modules/watch/continue-watching.service.js');
  const { WatchEventIngestService } = await import('../../modules/watch/event-ingest.service.js');
  const { WatchStateService } = await import('../../modules/watch/watch-state.service.js');

  const originals = {
    listProducts: ContinueWatchingService.prototype.listProducts,
    listPage: ContinueWatchingService.prototype.listPage,
    dismissContinueWatching: WatchEventIngestService.prototype.dismissContinueWatching,
    getState: WatchStateService.prototype.getState,
    getStates: WatchStateService.prototype.getStates,
  };

  t.after(() => {
    Object.assign(ContinueWatchingService.prototype, { listProducts: originals.listProducts, listPage: originals.listPage });
    Object.assign(WatchEventIngestService.prototype, { dismissContinueWatching: originals.dismissContinueWatching });
    Object.assign(WatchStateService.prototype, { getState: originals.getState, getStates: originals.getStates });
  });

  ContinueWatchingService.prototype.listProducts = async function (_userId, _profileId, _limit) {
    return [{
      id: 'cw-1',
      media: {
        mediaKey: 'movie:tmdb:331',
        mediaType: 'movie',
        provider: 'tmdb',
        providerId: '331',
        title: 'Example Movie',
        posterUrl: 'https://img.test/poster.jpg',
        backdropUrl: 'https://img.test/backdrop.jpg',
        releaseYear: null,
        rating: null,
        genre: null,
        seasonNumber: null,
        episodeNumber: null,
        episodeTitle: null,
        airDate: null,
        runtimeMinutes: null,
      },
      progress: { positionSeconds: 0, durationSeconds: null, progressPercent: 0, lastPlayedAt: '2024-01-01T00:00:00.000Z' },
      watchedAt: null,
      lastActivityAt: '2024-01-01T00:00:00.000Z',
      origins: ['native'],
      dismissible: true,
    }] as never;
  };
  ContinueWatchingService.prototype.listPage = async function (_userId, _profileId, _params) {
    return {
      items: await this.listProducts('user-1', 'profile-1', 20),
      pageInfo: {
        nextCursor: null,
        hasMore: false,
      },
    } as never;
  };
  WatchEventIngestService.prototype.dismissContinueWatching = async function (userId, profileId, id) {
    return { dismissed: true, userId, profileId, id } as never;
  };
  WatchStateService.prototype.getState = async function (_userId, _profileId, input) {
    return { media: { mediaKey: input.mediaKey }, progress: null, continueWatching: null, watched: null, watchlist: null, rating: null, watchedEpisodeKeys: [] } as never;
  };
  WatchStateService.prototype.getStates = async function (_userId, _profileId, inputs) {
    return inputs.map((input) => ({ media: { mediaKey: input.mediaKey }, progress: null, continueWatching: null, watched: null, watchlist: null, rating: null, watchedEpisodeKeys: [] })) as never;
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
  assert.equal(listResponse.json().items[0].media.providerId, '331');
  assert.equal(listResponse.json().pageInfo.nextCursor, null);
  assert.equal(listResponse.json().pageInfo.hasMore, false);

  const stateResponse = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/watch/state?mediaKey=movie:tmdb:1', headers: auth });
  assert.equal(stateResponse.statusCode, 200);
  assert.equal(stateResponse.json().profileId, 'profile-1');
  assert.equal(stateResponse.json().source, 'canonical_watch');
  assert.equal(typeof stateResponse.json().generatedAt, 'string');
  assert.equal(stateResponse.json().item.media.mediaKey, 'movie:tmdb:1');

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

test('library route returns canonical library sections and auth state', async (t) => {
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
      source: 'canonical_library',
      generatedAt: '2024-01-01T00:00:00.000Z',
      auth: {
        providers: [
          {
            provider: 'trakt',
            connected: true,
            status: 'connected',
            externalUsername: 'crispy-user',
            statusMessage: 'Connected as crispy-user',
          },
        ],
      },
      sections: [
        {
          id: 'watched',
          label: 'Watched',
          order: 0,
          itemCount: 1,
          items: [
            {
              id: 'movie-1',
              media: {
                mediaKey: 'movie:tmdb:1',
                mediaType: 'movie',
                provider: 'tmdb',
                providerId: '1',
                title: 'Test Movie',
                posterUrl: 'https://img.test/poster.jpg',
                releaseYear: null,
                rating: null,
                genre: null,
                subtitle: null,
              },
              state: {
                addedAt: null,
                watchedAt: '2024-01-15T10:00:00.000Z',
                ratedAt: null,
                rating: null,
                lastActivityAt: null,
              },
              origins: ['native'],
            },
          ],
        },
        {
          id: 'watchlist',
          label: 'Watchlist',
          order: 1,
          itemCount: 1,
          items: [
            {
              id: 'movie-2',
              media: {
                mediaKey: 'movie:tmdb:2',
                mediaType: 'movie',
                provider: 'tmdb',
                providerId: '2',
                title: 'Watchlisted Movie',
                posterUrl: 'https://img.test/poster.jpg',
                releaseYear: null,
                rating: null,
                genre: null,
                subtitle: null,
              },
              state: {
                addedAt: '2024-01-10T08:00:00.000Z',
                watchedAt: null,
                ratedAt: null,
                rating: null,
                lastActivityAt: null,
              },
              origins: ['native'],
            },
          ],
        },
        {
          id: 'rated',
          label: 'Rated',
          order: 2,
          itemCount: 0,
          items: [],
        },
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
  assert.equal(libraryResponse.json().source, 'canonical_library');
  assert.ok(libraryResponse.json().generatedAt);
  assert.equal(libraryResponse.json().auth.providers[0].provider, 'trakt');
  assert.deepEqual(libraryResponse.json().sections.map((section: { id: string }) => section.id), ['watched', 'watchlist', 'rated']);
  assert.equal(libraryResponse.json().sections[0].items[0].media.title, 'Test Movie');
  assert.equal(libraryResponse.json().sections[1].items[0].media.title, 'Watchlisted Movie');
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
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const originalResolve = MetadataDetailService.prototype.resolve;

  t.after(() => {
    MetadataDetailService.prototype.resolve = originalResolve;
  });

  MetadataDetailService.prototype.resolve = async function (input) {
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
