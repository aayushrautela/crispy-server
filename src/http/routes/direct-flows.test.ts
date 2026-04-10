import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-id', SIMKL_IMPORT_CLIENT_ID: 'simkl-id' });

test('metadata direct routes parse inputs and return service payloads', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const { MetadataRatingsService } = await import('../../modules/metadata/metadata-ratings.service.js');
  const { MetadataReviewsService } = await import('../../modules/metadata/metadata-reviews.service.js');
  const { PersonDetailService } = await import('../../modules/metadata/person-detail.service.js');
  const { PlaybackResolveService } = await import('../../modules/metadata/playback-resolve.service.js');
  const originals = {
    getPersonDetail: PersonDetailService.prototype.getPersonDetail,
    getTitleRatings: MetadataRatingsService.prototype.getTitleRatings,
    getTitleReviews: MetadataReviewsService.prototype.getTitleReviews,
    resolvePlayback: PlaybackResolveService.prototype.resolvePlayback,
    getTitleDetailById: MetadataDetailService.prototype.getTitleDetailById,
  };

  t.after(() => {
    Object.assign(PersonDetailService.prototype, { getPersonDetail: originals.getPersonDetail });
    Object.assign(MetadataRatingsService.prototype, { getTitleRatings: originals.getTitleRatings });
    Object.assign(MetadataReviewsService.prototype, { getTitleReviews: originals.getTitleReviews });
    Object.assign(PlaybackResolveService.prototype, { resolvePlayback: originals.resolvePlayback });
    Object.assign(MetadataDetailService.prototype, { getTitleDetailById: originals.getTitleDetailById });
  });

  let receivedPersonLanguage: string | null = null;
  let receivedTitleLanguage: string | null = null;
  let receivedPlaybackLanguage: string | null = null;
  let receivedPlaybackMediaKey: string | null = null;
  let receivedReviewsLanguage: string | null = null;
  let receivedReviewsMediaKey: string | null = null;
  let receivedReviewsProfileId: string | null = null;
  let receivedReviewsUserId: string | null = null;
  let receivedRatingsMediaKey: string | null = null;
  let receivedRatingsProfileId: string | null = null;
  let receivedRatingsUserId: string | null = null;
  let receivedResolveInput: { mediaType?: string; kitsuId?: number | string | null } | null = null;

  PersonDetailService.prototype.getPersonDetail = async function (id, language) {
    receivedPersonLanguage = language ?? null;
    return { id: `person:${id}`, provider: 'tmdb', providerId: '44', tmdbPersonId: 44, name: 'Person', knownForDepartment: null, biography: null, birthday: null, placeOfBirth: null, profileUrl: null, imdbId: null, instagramId: null, twitterId: null, knownFor: [] } as never;
  };
  MetadataReviewsService.prototype.getTitleReviews = async function (userId, profileId, mediaKey, language?: string | null) {
    receivedReviewsUserId = userId;
    receivedReviewsProfileId = profileId;
    receivedReviewsMediaKey = mediaKey;
    receivedReviewsLanguage = language ?? null;
    return {
      reviews: [{ id: 'review-1', provider: 'tmdb', author: 'Critic', username: 'critic1', content: 'Great movie', createdAt: '2024-01-02T00:00:00.000Z', updatedAt: '2024-01-03T00:00:00.000Z', url: 'https://example.com/review', rating: 8, avatarUrl: null }],
    } as never;
  };
  MetadataRatingsService.prototype.getTitleRatings = async function (userId, profileId, mediaKey) {
    receivedRatingsUserId = userId;
    receivedRatingsProfileId = profileId;
    receivedRatingsMediaKey = mediaKey;
    return {
      ratings: {
        imdb: 7.5,
        tmdb: 7.8,
        trakt: 8.1,
        metacritic: 70,
        rottenTomatoes: 80,
        audience: 82,
        letterboxd: 3.9,
        rogerEbert: 4,
        myAnimeList: null,
      },
    } as never;
  };
  MetadataDetailService.prototype.getTitleDetailById = async function (id: string, language?: string | null) {
    receivedTitleLanguage = language ?? null;
    return {
      item: {
        mediaType: 'movie',
        kind: 'title',
        mediaKey: id,
        provider: 'tmdb',
        providerId: id,
        parentMediaType: null,
        parentProvider: null,
        parentProviderId: null,
        tmdbId: 222,
        showTmdbId: null,
        seasonNumber: null,
        episodeNumber: null,
        absoluteEpisodeNumber: null,
        title: 'Movie',
        subtitle: null,
        summary: null,
        overview: null,
        artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
        images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
        releaseDate: null,
        releaseYear: null,
        runtimeMinutes: null,
        rating: null,
        certification: null,
        status: null,
        genres: [],
        externalIds: { tmdb: 222, imdb: 'tt1234567', tvdb: null, kitsu: null },
        seasonCount: null,
        episodeCount: null,
        nextEpisode: null,
      },
      seasons: [],
      episodes: [],
      nextEpisode: null,
      videos: [{ id: 'video-1', key: 'abc123', name: 'Trailer', site: 'YouTube', type: 'Trailer', official: true, publishedAt: '2024-01-01T00:00:00.000Z', url: 'https://www.youtube.com/watch?v=abc123', thumbnailUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg' }],
      cast: [{ id: 'person:tmdb:10', provider: 'tmdb', providerId: '10', tmdbPersonId: 10, name: 'Lead Actor', role: 'Hero', department: 'Acting', profileUrl: 'https://image.tmdb.org/t/p/w185/actor.jpg' }],
      directors: [{ id: 'person:tmdb:11', provider: 'tmdb', providerId: '11', tmdbPersonId: 11, name: 'Director Name', role: 'Director', department: 'Directing', profileUrl: null }],
      creators: [{ id: 'person:tmdb:12', provider: 'tmdb', providerId: '12', tmdbPersonId: 12, name: 'Creator Name', role: null, department: 'Writing', profileUrl: null }],
      production: { originalLanguage: 'en', originCountries: ['US'], spokenLanguages: ['English'], productionCountries: ['United States of America'], companies: [], networks: [] },
      collection: {
        id: 99,
        provider: 'tmdb',
        providerId: '99',
        name: 'Saga Collection',
        posterUrl: null,
        backdropUrl: null,
        parts: [
          {
            mediaType: 'movie',
            mediaKey: 'movie:tmdb:101',
            provider: 'tmdb',
            providerId: '101',
            title: 'Saga Collection: Part I',
            posterUrl: 'https://img.test/poster.jpg',
            releaseYear: 2020,
            rating: 7.1,
            genre: null,
            subtitle: null,
          },
        ],
      },
      similar: [{ mediaType: 'movie', mediaKey: 'movie:tmdb:77', provider: 'tmdb', providerId: '77', title: 'Another Movie', posterUrl: 'https://img.test/poster.jpg', releaseYear: 2025, rating: 7.9, genre: null, subtitle: null }],
    } as never;
  };
  PlaybackResolveService.prototype.resolvePlayback = async function (input) {
    receivedPlaybackLanguage = input.language ?? null;
    receivedPlaybackMediaKey = input.mediaKey ?? null;
    return {
      item: {
        mediaType: 'movie',
        kind: 'title',
        mediaKey: input.mediaKey ?? 'fallback',
        provider: 'tmdb',
        providerId: input.mediaKey ?? 'fallback',
        parentMediaType: null,
        parentProvider: null,
        parentProviderId: null,
        tmdbId: 222,
        showTmdbId: null,
        seasonNumber: null,
        episodeNumber: null,
        absoluteEpisodeNumber: null,
        title: 'Movie',
        subtitle: null,
        summary: null,
        overview: null,
        artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
        images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
        releaseDate: null,
        releaseYear: null,
        runtimeMinutes: null,
        rating: null,
        certification: null,
        status: null,
        genres: [],
        externalIds: { tmdb: 222, imdb: 'tt1234567', tvdb: null, kitsu: null },
        seasonCount: null,
        episodeCount: null,
        nextEpisode: null,
      },
      show: null,
      season: null,
    } as never;
  };

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const personResponse = await app.inject({ method: 'GET', url: '/v1/metadata/people/44?language=en-US', headers: auth });
  assert.equal(personResponse.statusCode, 200);
  assert.equal(receivedPersonLanguage, 'en-US');

  const movieMediaKey = 'movie:tmdb:222';

  const titleDetailResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${movieMediaKey}?language=fr-FR`, headers: auth });
  assert.equal(titleDetailResponse.statusCode, 200);
  assert.equal(titleDetailResponse.json().item.mediaKey, movieMediaKey);
  assert.equal(receivedTitleLanguage, 'fr-FR');
  assert.equal(titleDetailResponse.json().videos[0].key, 'abc123');
  assert.equal(titleDetailResponse.json().cast[0].name, 'Lead Actor');
  assert.equal(titleDetailResponse.json().directors[0].name, 'Director Name');
  assert.equal(titleDetailResponse.json().creators[0].name, 'Creator Name');
  assert.equal(titleDetailResponse.json().production.originalLanguage, 'en');
  assert.equal(titleDetailResponse.json().collection.name, 'Saga Collection');
  assert.equal(titleDetailResponse.json().collection.parts[0].mediaKey, 'movie:tmdb:101');
  assert.equal(titleDetailResponse.json().collection.parts[0].providerId, '101');
  assert.equal(titleDetailResponse.json().similar[0].mediaKey, 'movie:tmdb:77');
  assert.equal(titleDetailResponse.json().similar[0].providerId, '77');

  const titleReviewsResponse = await app.inject({ method: 'GET', url: `/v1/profiles/profile-1/metadata/titles/${movieMediaKey}/reviews?language=it-IT`, headers: auth });
  assert.equal(titleReviewsResponse.statusCode, 200);
  assert.equal(titleReviewsResponse.json().reviews[0].id, 'review-1');
  assert.equal(receivedReviewsUserId, 'user-1');
  assert.equal(receivedReviewsProfileId, 'profile-1');
  assert.equal(receivedReviewsMediaKey, movieMediaKey);
  assert.equal(receivedReviewsLanguage, 'it-IT');

  const titleRatingsResponse = await app.inject({ method: 'GET', url: `/v1/profiles/profile-1/metadata/titles/${movieMediaKey}/ratings`, headers: auth });
  assert.equal(titleRatingsResponse.statusCode, 200);
  assert.equal(titleRatingsResponse.json().ratings.imdb, 7.5);
  assert.equal(receivedRatingsUserId, 'user-1');
  assert.equal(receivedRatingsProfileId, 'profile-1');
  assert.equal(receivedRatingsMediaKey, movieMediaKey);

  const playbackResponse = await app.inject({ method: 'GET', url: `/v1/playback/resolve?mediaKey=${movieMediaKey}&language=de-DE`, headers: auth });
  assert.equal(playbackResponse.statusCode, 200);
  assert.equal(playbackResponse.json().item.mediaKey, movieMediaKey);
  assert.equal(receivedPlaybackLanguage, 'de-DE');
  assert.equal(receivedPlaybackMediaKey, movieMediaKey);
});

test('watch routes expose continue-watching ids and forward dismiss params', async (t) => {
  const { PersonalMediaService } = await import('../../modules/watch/personal-media.service.js');
  const { WatchEventIngestService } = await import('../../modules/watch/event-ingest.service.js');
  const { WatchStateService } = await import('../../modules/watch/watch-state.service.js');

  const originals = {
    listContinueWatchingProducts: PersonalMediaService.prototype.listContinueWatchingProducts,
    listContinueWatchingPage: PersonalMediaService.prototype.listContinueWatchingPage,
    listHistoryPage: PersonalMediaService.prototype.listHistoryPage,
    listWatchlistPage: PersonalMediaService.prototype.listWatchlistPage,
    listRatingsPage: PersonalMediaService.prototype.listRatingsPage,
    dismissContinueWatching: WatchEventIngestService.prototype.dismissContinueWatching,
    getState: WatchStateService.prototype.getState,
    getStates: WatchStateService.prototype.getStates,
  };

  t.after(() => {
    Object.assign(PersonalMediaService.prototype, {
      listContinueWatchingProducts: originals.listContinueWatchingProducts,
      listContinueWatchingPage: originals.listContinueWatchingPage,
      listHistoryPage: originals.listHistoryPage,
      listWatchlistPage: originals.listWatchlistPage,
      listRatingsPage: originals.listRatingsPage,
    });
    Object.assign(WatchEventIngestService.prototype, { dismissContinueWatching: originals.dismissContinueWatching });
    Object.assign(WatchStateService.prototype, { getState: originals.getState, getStates: originals.getStates });
  });

  PersonalMediaService.prototype.listContinueWatchingProducts = async function (_userId, _profileId, _limit) {
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
      lastActivityAt: '2024-01-01T00:00:00.000Z',
      origins: ['native'],
      dismissible: true,
    }] as never;
  };
  PersonalMediaService.prototype.listContinueWatchingPage = async function (_userId, _profileId, _params) {
    return {
      items: await this.listContinueWatchingProducts('user-1', 'profile-1', 20),
      pageInfo: {
        nextCursor: null,
        hasMore: false,
      },
    } as never;
  };
  PersonalMediaService.prototype.listHistoryPage = async function () {
    return {
      items: [
        {
          media: {
            mediaKey: 'movie:tmdb:42',
            mediaType: 'movie',
            provider: 'tmdb',
            providerId: '42',
            title: 'History Movie',
            posterUrl: 'https://img.test/poster.jpg',
            releaseYear: null,
            rating: null,
            genre: null,
            subtitle: null,
          },
          watchedAt: '2024-01-02T00:00:00.000Z',
          origins: ['native'],
        },
      ],
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
    return {
      media: {
        mediaType: 'movie',
        mediaKey: input.mediaKey,
        provider: 'tmdb',
        providerId: '1',
        title: 'Example Movie',
        posterUrl: 'https://img.test/poster.jpg',
        releaseYear: null,
        rating: null,
        genre: null,
        subtitle: null,
      },
      progress: null,
      continueWatching: null,
      watched: null,
      watchlist: null,
      rating: null,
      watchedEpisodeKeys: [],
    } as never;
  };
  WatchStateService.prototype.getStates = async function (_userId, _profileId, inputs) {
    return inputs.map((input) => ({
      media: {
        mediaType: input.mediaKey.startsWith('show:') ? 'show' : 'movie',
        mediaKey: input.mediaKey,
        provider: 'tmdb',
        providerId: input.mediaKey.startsWith('show:') ? '2' : '1',
        title: input.mediaKey.startsWith('show:') ? 'Example Show' : 'Example Movie',
        posterUrl: 'https://img.test/poster.jpg',
        releaseYear: null,
        rating: null,
        genre: null,
        subtitle: null,
      },
      progress: null,
      continueWatching: null,
      watched: null,
      watchlist: null,
      rating: null,
      watchedEpisodeKeys: [],
    })) as never;
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
  assert.equal('watchedAt' in listResponse.json().items[0], false);
  assert.equal(listResponse.json().pageInfo.nextCursor, null);
  assert.equal(listResponse.json().pageInfo.hasMore, false);

  const historyResponse = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/watch/history?limit=7', headers: auth });
  assert.equal(historyResponse.statusCode, 200);
  assert.equal(historyResponse.json().kind, 'history');
  assert.equal(historyResponse.json().items[0].watchedAt, '2024-01-02T00:00:00.000Z');

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
    payload: { items: [{ mediaKey: 'movie:tmdb:1' }, { mediaKey: 'show:tvdb:2' }] },
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

test('profile routes expose import-connections', async (t) => {
  const { ProviderImportService } = await import('../../modules/integrations/provider-import.service.js');
  const originals = {
    listConnections: ProviderImportService.prototype.listConnections,
  };

  t.after(() => {
    Object.assign(ProviderImportService.prototype, originals);
  });

  ProviderImportService.prototype.listConnections = async function (_userId, _profileId) {
    return {
      providerAccounts: [
        {
          id: 'conn-1',
          provider: 'trakt',
          status: 'connected',
          providerUserId: 'user-42',
          externalUsername: 'crispy-user',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          lastUsedAt: null,
          lastImportJobId: null,
          lastImportCompletedAt: null,
        },
      ],
      watchDataState: {
        profileId: 'profile-1',
        watchDataUpdatedAt: '2024-01-03T00:00:00.000Z',
        watchDataOrigin: 'provider_import',
        lastImportCompletedAt: '2024-01-03T00:00:00.000Z',
      },
    } as never;
  };

  const { registerProfileRoutes } = await import('./profiles.js');
  const app = await buildTestApp(registerProfileRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };
  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/import-connections', headers: auth });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().providerAccounts[0].provider, 'trakt');
  assert.equal(response.json().providerAccounts[0].status, 'connected');
  assert.equal(response.json().watchDataState.watchDataOrigin, 'provider_import');
});

test('metadata resolve route accepts provider-shaped query input', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const originalResolve = MetadataDetailService.prototype.resolve;

  t.after(() => {
    MetadataDetailService.prototype.resolve = originalResolve;
  });

  type ResolveInputCapture = { mediaType?: string; kitsuId?: number | string | null };
  let receivedResolveInput: ResolveInputCapture | null = null;

  MetadataDetailService.prototype.resolve = async function (input) {
    receivedResolveInput = input as ResolveInputCapture;
    return {
      item: {
        mediaType: 'anime',
        kind: 'title',
        mediaKey: 'anime:kitsu:123',
        provider: 'kitsu',
        providerId: '123',
        parentMediaType: null,
        parentProvider: null,
        parentProviderId: null,
        tmdbId: null,
        showTmdbId: null,
        seasonNumber: null,
        episodeNumber: null,
        absoluteEpisodeNumber: null,
        title: 'Anime',
        subtitle: null,
        summary: null,
        overview: null,
        artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
        images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
        releaseDate: null,
        releaseYear: null,
        runtimeMinutes: null,
        rating: null,
        certification: null,
        status: null,
        genres: [],
        externalIds: { tmdb: null, imdb: null, tvdb: null, kitsu: '123' },
        seasonCount: null,
        episodeCount: null,
        nextEpisode: null,
      },
    } as never;
  };

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metadata/resolve?mediaType=anime&provider=kitsu&providerId=123',
    headers: { authorization: 'Bearer test' },
  });
  const resolvedJson = response.json() as { item: { mediaType: string; provider: string; providerId: string; externalIds: { kitsu: string | null } } };

  assert.equal(response.statusCode, 200);
  assert.equal(resolvedJson.item.mediaType, 'anime');
  assert.equal(resolvedJson.item.provider, 'kitsu');
  assert.equal(resolvedJson.item.providerId, '123');
  assert.equal(resolvedJson.item.externalIds.kitsu, '123');
  assert.ok(receivedResolveInput);
  const resolveInput = receivedResolveInput as ResolveInputCapture;
  assert.equal(resolveInput.mediaType, 'anime');
  assert.equal(resolveInput.kitsuId, 123);
});
