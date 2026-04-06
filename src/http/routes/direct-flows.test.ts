import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-id', SIMKL_IMPORT_CLIENT_ID: 'simkl-id' });

test('metadata direct routes parse inputs and return service payloads', async (t) => {
  const { MetadataContentService } = await import('../../modules/metadata/metadata-content.service.js');
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const { EpisodeNavigationService } = await import('../../modules/metadata/episode-navigation.service.js');
  const { PersonDetailService } = await import('../../modules/metadata/person-detail.service.js');
  const { PlaybackResolveService } = await import('../../modules/metadata/playback-resolve.service.js');
  const originals = {
    getPersonDetail: PersonDetailService.prototype.getPersonDetail,
    listEpisodes: EpisodeNavigationService.prototype.listEpisodes,
    getNextEpisode: EpisodeNavigationService.prototype.getNextEpisode,
    getTitleContent: MetadataContentService.prototype.getTitleContent,
    resolvePlayback: PlaybackResolveService.prototype.resolvePlayback,
    getTitleDetailById: MetadataDetailService.prototype.getTitleDetailById,
  };

  t.after(() => {
    Object.assign(PersonDetailService.prototype, { getPersonDetail: originals.getPersonDetail });
    Object.assign(EpisodeNavigationService.prototype, { listEpisodes: originals.listEpisodes, getNextEpisode: originals.getNextEpisode });
    Object.assign(MetadataContentService.prototype, { getTitleContent: originals.getTitleContent });
    Object.assign(PlaybackResolveService.prototype, { resolvePlayback: originals.resolvePlayback });
    Object.assign(MetadataDetailService.prototype, { getTitleDetailById: originals.getTitleDetailById });
  });

  let receivedPersonLanguage: string | null = null;
  let receivedTitleLanguage: string | null = null;
  let receivedEpisodesLanguage: string | null = null;
  let receivedNextEpisodeLanguage: string | null = null;
  let receivedPlaybackLanguage: string | null = null;
  let receivedWatchedKeys: string[] | null = null;
  let receivedShowMediaKey: string | null = null;
  let receivedNowMs: number | null = null;
  let receivedPlaybackMediaKey: string | null = null;
  let receivedResolveInput: { mediaType?: string; kitsuId?: number | string | null } | null = null;

  PersonDetailService.prototype.getPersonDetail = async function (id, language) {
    receivedPersonLanguage = language ?? null;
    return { id: `person:${id}`, provider: 'tmdb', providerId: '44', tmdbPersonId: 44, name: 'Person', knownForDepartment: null, biography: null, birthday: null, placeOfBirth: null, profileUrl: null, imdbId: null, instagramId: null, twitterId: null, knownFor: [] } as never;
  };
  EpisodeNavigationService.prototype.listEpisodes = async function (id, seasonNumber, language) {
    receivedEpisodesLanguage = language ?? null;
    return {
      show: {
        mediaType: 'show',
        kind: 'title',
        mediaKey: id,
        provider: 'tmdb',
        providerId: id,
        parentMediaType: null,
        parentProvider: null,
        parentProviderId: null,
        tmdbId: 111,
        showTmdbId: null,
        seasonNumber: null,
        episodeNumber: null,
        absoluteEpisodeNumber: null,
        title: 'Show',
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
        externalIds: { tmdb: 111, imdb: 'tt123', tvdb: null, kitsu: null },
        seasonCount: null,
        episodeCount: null,
        nextEpisode: null,
      },
      requestedSeasonNumber: seasonNumber ?? null,
      effectiveSeasonNumber: seasonNumber ?? 1,
      includedSeasonNumbers: seasonNumber ? [seasonNumber] : [1],
      episodes: [],
    } as never;
  };
  EpisodeNavigationService.prototype.getNextEpisode = async function (id, input) {
    receivedNextEpisodeLanguage = input.language ?? null;
    receivedWatchedKeys = input.watchedKeys ?? null;
    receivedShowMediaKey = input.showMediaKey ?? null;
    receivedNowMs = input.nowMs ?? null;
    return {
      show: {
        mediaType: 'show',
        kind: 'title',
        mediaKey: id,
        provider: 'tmdb',
        providerId: id,
        parentMediaType: null,
        parentProvider: null,
        parentProviderId: null,
        tmdbId: 111,
        showTmdbId: null,
        seasonNumber: null,
        episodeNumber: null,
        absoluteEpisodeNumber: null,
        title: 'Show',
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
        externalIds: { tmdb: 111, imdb: 'tt123', tvdb: null, kitsu: null },
        seasonCount: null,
        episodeCount: null,
        nextEpisode: null,
      },
      currentSeasonNumber: input.currentSeasonNumber,
      currentEpisodeNumber: input.currentEpisodeNumber,
      item: null,
    } as never;
  };
  MetadataContentService.prototype.getTitleContent = async function (userId, id) {
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
      content: {
        ids: { imdb: 'tt1234567', tmdb: 222, trakt: null, tvdb: null },
        title: 'Movie',
        originalTitle: null,
        type: 'movie',
        year: null,
        description: null,
        score: null,
        ratings: {
          imdbRating: null,
          imdbVotes: null,
          tmdbRating: null,
          metacritic: null,
          rottenTomatoes: null,
          letterboxdRating: null,
          mdblistRating: null,
        },
        posterUrl: null,
        backdropUrl: null,
        genres: [],
        keywords: [],
        runtime: null,
        certification: null,
        released: null,
        language: null,
        country: null,
        seasonCount: null,
        episodeCount: null,
        directors: [],
        writers: [],
        network: null,
        studio: null,
        status: null,
        budget: null,
        revenue: null,
        updatedAt: null,
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
      videos: [{ id: 'video-1', key: 'abc123', name: 'Trailer', site: 'YouTube', type: 'Trailer', official: true, publishedAt: '2024-01-01T00:00:00.000Z', url: 'https://www.youtube.com/watch?v=abc123', thumbnailUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg' }],
      cast: [{ id: 'person:tmdb:10', provider: 'tmdb', providerId: '10', tmdbPersonId: 10, name: 'Lead Actor', role: 'Hero', department: 'Acting', profileUrl: 'https://image.tmdb.org/t/p/w185/actor.jpg' }],
      directors: [{ id: 'person:tmdb:11', provider: 'tmdb', providerId: '11', tmdbPersonId: 11, name: 'Director Name', role: 'Director', department: 'Directing', profileUrl: null }],
      creators: [{ id: 'person:tmdb:12', provider: 'tmdb', providerId: '12', tmdbPersonId: 12, name: 'Creator Name', role: null, department: 'Writing', profileUrl: null }],
      reviews: [{ id: 'review-1', author: 'Critic', username: 'critic1', content: 'Great movie', createdAt: '2024-01-02T00:00:00.000Z', updatedAt: '2024-01-03T00:00:00.000Z', url: 'https://example.com/review', rating: 8, avatarUrl: null }],
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

  const showMediaKey = 'show:tmdb:111';
  const movieMediaKey = 'movie:tmdb:222';

  const episodesResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${showMediaKey}/episodes?seasonNumber=2&language=es-ES`, headers: auth });
  assert.equal(episodesResponse.statusCode, 200);
  assert.equal(episodesResponse.json().requestedSeasonNumber, 2);
  assert.equal(episodesResponse.json().show.mediaKey, showMediaKey);
  assert.equal(receivedEpisodesLanguage, 'es-ES');

  const titleDetailResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${movieMediaKey}?language=fr-FR`, headers: auth });
  assert.equal(titleDetailResponse.statusCode, 200);
  assert.equal(titleDetailResponse.json().item.mediaKey, movieMediaKey);
  assert.equal(receivedTitleLanguage, 'fr-FR');
  assert.equal(titleDetailResponse.json().videos[0].key, 'abc123');
  assert.equal(titleDetailResponse.json().cast[0].name, 'Lead Actor');
  assert.equal(titleDetailResponse.json().directors[0].name, 'Director Name');
  assert.equal(titleDetailResponse.json().creators[0].name, 'Creator Name');
  assert.equal(titleDetailResponse.json().reviews[0].id, 'review-1');
  assert.equal(titleDetailResponse.json().production.originalLanguage, 'en');
  assert.equal(titleDetailResponse.json().collection.name, 'Saga Collection');
  assert.equal(titleDetailResponse.json().collection.parts[0].mediaKey, 'movie:tmdb:101');
  assert.equal(titleDetailResponse.json().collection.parts[0].providerId, '101');
  assert.equal(titleDetailResponse.json().similar[0].mediaKey, 'movie:tmdb:77');
  assert.equal(titleDetailResponse.json().similar[0].providerId, '77');

  const nextEpisodeResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${showMediaKey}/next-episode?currentSeasonNumber=1&currentEpisodeNumber=2&watchedKeys=tt1:1:3,tt1:1:4&showMediaKey=show:tvdb:tt1&nowMs=1700000000000&language=ja-JP`, headers: auth });
  assert.equal(nextEpisodeResponse.statusCode, 200);
  assert.equal(receivedNextEpisodeLanguage, 'ja-JP');
  assert.deepEqual(receivedWatchedKeys, ['tt1:1:3', 'tt1:1:4']);
  assert.equal(receivedShowMediaKey, 'show:tvdb:tt1');
  assert.equal(receivedNowMs, 1700000000000);

  const contentResponse = await app.inject({ method: 'GET', url: `/v1/metadata/titles/${movieMediaKey}/content`, headers: auth });
  assert.equal(contentResponse.statusCode, 200);
  assert.equal(contentResponse.json().item.mediaKey, movieMediaKey);
  assert.equal(contentResponse.json().content.ids.imdb, 'tt1234567');

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
    listWatchedPage: PersonalMediaService.prototype.listWatchedPage,
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
      listWatchedPage: originals.listWatchedPage,
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
    getProfileLibrarySectionPage: LibraryService.prototype.getProfileLibrarySectionPage,
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
        },
        {
          id: 'watchlist',
          label: 'Watchlist',
          order: 1,
          itemCount: 1,
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
  assert.equal(libraryResponse.json().sections[0].itemCount, 1);
  assert.equal(libraryResponse.json().sections[1].itemCount, 1);
});

test('library section route returns paginated canonical library items', async (t) => {
  const { LibraryService } = await import('../../modules/library/library.service.js');
  const originals = {
    getProfileLibrary: LibraryService.prototype.getProfileLibrary,
    getProfileLibrarySectionPage: LibraryService.prototype.getProfileLibrarySectionPage,
  };

  t.after(() => {
    Object.assign(LibraryService.prototype, originals);
  });

  LibraryService.prototype.getProfileLibrarySectionPage = async function (_userId, profileId, sectionId) {
    return {
      profileId,
      source: 'canonical_library',
      generatedAt: '2024-01-01T00:00:00.000Z',
      section: {
        id: sectionId,
        label: 'Watched',
        order: 0,
      },
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
            lastActivityAt: '2024-01-15T10:00:00.000Z',
          },
          origins: ['native'],
        },
      ],
      pageInfo: {
        nextCursor: 'cursor-1',
        hasMore: true,
      },
    } as never;
  };

  const { registerLibraryRoutes } = await import('./library.js');
  const app = await buildTestApp(registerLibraryRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };
  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/library/sections/watched?limit=25', headers: auth });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().section.id, 'watched');
  assert.equal(response.json().items[0].media.title, 'Test Movie');
  assert.equal(response.json().pageInfo.nextCursor, 'cursor-1');
  assert.equal(response.json().pageInfo.hasMore, true);
});

test('library section route returns 404 for unknown section ids', async (t) => {
  const { LibraryService } = await import('../../modules/library/library.service.js');
  const originals = {
    getProfileLibrarySectionPage: LibraryService.prototype.getProfileLibrarySectionPage,
  };

  t.after(() => {
    Object.assign(LibraryService.prototype, originals);
  });

  LibraryService.prototype.getProfileLibrarySectionPage = async function () {
    throw new HttpError(404, 'Unknown library section: favorites.');
  };

  const { registerLibraryRoutes } = await import('./library.js');
  const app = await buildTestApp(registerLibraryRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };
  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/library/sections/favorites', headers: auth });

  assert.equal(response.statusCode, 404);
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
