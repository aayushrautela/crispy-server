import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientMediaCard } from '../../modules/recommendations/client-home.types.js';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv();

const MOVIE_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a805';
const SHOW_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a806';
const EPISODE_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a807';
const SEASON_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a808';

function makeClientMediaCard(id = MOVIE_ITEM_ID): ClientMediaCard {
  const mediaType = id === SHOW_ITEM_ID ? 'tv' : id === EPISODE_ITEM_ID ? 'episode' : id === SEASON_ITEM_ID ? 'season' : 'movie';
  return {
    itemId: id,
    mediaType,
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
    providerIds: { tmdb: '694', imdb: null, tvdb: null },
  };
}

function makeEpisodeClientMediaCard(overrides?: Partial<ClientMediaCard>): ClientMediaCard {
  return {
    ...makeClientMediaCard(EPISODE_ITEM_ID),
    title: 'Episode Title',
    parent: {
      seriesItemId: SHOW_ITEM_ID,
      seriesTitle: "Bob's Burgers",
      seasonItemId: SEASON_ITEM_ID,
      seasonNumber: 16,
      episodeNumber: 1,
    },
    releaseDate: '2025-09-28',
    ...overrides,
  };
}

function makeSeasonClientMediaCard(overrides?: Partial<ClientMediaCard>): ClientMediaCard {
  return {
    ...makeClientMediaCard(SEASON_ITEM_ID),
    mediaType: 'season',
    title: 'Season 1',
    parent: {
      seriesItemId: SHOW_ITEM_ID,
      seasonNumber: 1,
    },
    ...overrides,
  };
}

function makeTitleDetail(itemId = MOVIE_ITEM_ID) {
  return {
    Item: makeClientMediaCard(itemId),
    NextEpisode: null,
    Videos: [],
    Cast: [],
    Creators: [],
    Directors: [],
    Production: {
      originalLanguage: null,
      originCountries: [],
      spokenLanguages: [],
      productionCountries: [],
      companies: [],
      networks: [],
    },
    Backdrops: [],
  };
}

test('GET /v1/metadata/items/:itemId serializes collection with no parts', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const original = MetadataDetailService.prototype.getItemDetail;

  MetadataDetailService.prototype.getItemDetail = (async () => makeTitleDetail()) as any;
  t.after(() => { MetadataDetailService.prototype.getItemDetail = original; });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: `/v1/metadata/items/${MOVIE_ITEM_ID}?language=en-US`,
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.Collection, undefined);
  assert.equal(body.data.Item.itemId, MOVIE_ITEM_ID);
});

test('GET /v1/metadata/items/:itemId serializes show with nextEpisode', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const original = MetadataDetailService.prototype.getItemDetail;

  MetadataDetailService.prototype.getItemDetail = (async () => ({
    ...makeTitleDetail(SHOW_ITEM_ID),
    Item: makeClientMediaCard(SHOW_ITEM_ID),
    NextEpisode: makeEpisodeClientMediaCard(),
  })) as any;
  t.after(() => { MetadataDetailService.prototype.getItemDetail = original; });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: `/v1/metadata/items/${SHOW_ITEM_ID}?language=en-US`,
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.data.NextEpisode);
  assert.equal(body.data.NextEpisode.itemId, EPISODE_ITEM_ID);
  assert.equal(body.data.NextEpisode.parent.seriesItemId, SHOW_ITEM_ID);
  assert.equal(body.data.NextEpisode.parent.seasonItemId, SEASON_ITEM_ID);
  assert.equal(body.data.NextEpisode.parent.seasonNumber, 16);
  assert.equal(body.data.NextEpisode.parent.episodeNumber, 1);
  assert.ok(body.data.NextEpisode.images);
});

test('GET /v1/metadata/items/:itemId rejects colon and raw numeric ids', async (t) => {
  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  for (const itemId of ['movie:tmdb:694', '694']) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/metadata/items/${encodeURIComponent(itemId)}`,
      headers: { authorization: 'Bearer test' },
    });
    assert.equal(response.statusCode, 400);
  }
});

test('old metadata title routes are absent', async (t) => {
  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metadata/titles/movie:tmdb:694?language=en-US',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 404);
});

test('GET /v1/metadata/items/:itemId/extras serializes movie extras', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { MetadataTitleExtrasService } = await import('../../modules/metadata/metadata-title-extras.service.js');
  const { MetadataCardService } = await import('../../modules/metadata/metadata-card.service.js');
  const original = MetadataTitleExtrasService.prototype.getTitleExtrasInternal;
  const originalBuildCardViews = MetadataCardService.prototype.buildCardViews;

  MetadataTitleExtrasService.prototype.getTitleExtrasInternal = (async () => ({
    seasonIdentities: [],
    seriesItemId: '',
    seriesTitle: null,
    reviews: [
      {
        id: 'rev-1',
        provider: 'tmdb',
        author: 'Author',
        username: 'author123',
        content: 'Great movie!',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        url: 'https://example.com/review/1',
        rating: 8,
        avatarUrl: null,
      },
    ],
    similar: [
      { mediaKey: 'movie:tmdb:694', mediaType: 'movie', provider: 'tmdb', providerId: '694', tmdbId: 694, contentId: 'f137a2dd21bbc1b99aa5c0f6bf02a809' },
    ],
    collection: [
      { mediaKey: 'movie:tmdb:695', mediaType: 'movie', provider: 'tmdb', providerId: '695', tmdbId: 695, contentId: 'f137a2dd21bbc1b99aa5c0f6bf02a80a' },
    ],
    resolvedTitle: {} as any,
    effectiveLanguage: 'en-US',
  })) as any;
  MetadataCardService.prototype.buildCardViews = (async () => [{
    mediaType: 'movie',
    kind: 'title',
    itemId: 'f137a2dd21bbc1b99aa5c0f6bf02a809',
    parentMediaType: null,
    seriesItemId: null,
    seasonItemId: null,
    tmdbId: 694,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    title: 'Similar Movie',
    subtitle: null,
    summary: null,
    overview: null,
    tagline: null,
    artwork: { poster: null, backdrop: null, still: null },
    images: { poster: null, backdrop: null, logo: null, still: null },
    releaseDate: null,
    releaseYear: null,
    runtimeMinutes: null,
    rating: null,
    status: null,
    maturityRating: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    genres: [],
    externalIds: { tmdb: 694, imdb: null, tvdb: null },
  }]) as any;
  t.after(() => {
    MetadataTitleExtrasService.prototype.getTitleExtrasInternal = original;
    MetadataCardService.prototype.buildCardViews = originalBuildCardViews;
  });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: `/v1/metadata/items/${MOVIE_ITEM_ID}/extras?language=en-US`,
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.Reviews.length, 1);
  assert.equal(body.data.Reviews[0].id, 'rev-1');
  assert.equal(body.data.Similar.length, 1);
  assert.equal(body.data.Similar[0].itemId, 'f137a2dd21bbc1b99aa5c0f6bf02a809');
  assert.ok(body.data.Collection);
  assert.equal(body.data.Collection.Items.length, 1);
});

test('GET /v1/metadata/items/:itemId/extras serializes show seasons', async (t) => {
  const { db: pool } = await import('../../lib/db.js');
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  });
  t.after(() => {
    delete (pool as unknown as Record<string, unknown>).connect;
  });

  const { MetadataTitleExtrasService } = await import('../../modules/metadata/metadata-title-extras.service.js');
  const { MetadataCardService } = await import('../../modules/metadata/metadata-card.service.js');
  const original = MetadataTitleExtrasService.prototype.getTitleExtrasInternal;
  const originalBuildCardViews = MetadataCardService.prototype.buildCardViews;

  MetadataTitleExtrasService.prototype.getTitleExtrasInternal = (async () => ({
    seasonIdentities: [
      { mediaKey: 'season:tmdb:12345:1', mediaType: 'season', provider: 'tmdb', showTmdbId: 12345, seasonNumber: 1 },
    ],
    seriesItemId: SHOW_ITEM_ID,
    seriesTitle: 'Test Show',
    reviews: [],
    similar: [],
    collection: null,
    resolvedTitle: {} as any,
    effectiveLanguage: 'en-US',
  })) as any;
  MetadataCardService.prototype.buildCardViews = (async () => [{
    mediaType: 'season',
    kind: 'season',
    itemId: SEASON_ITEM_ID,
    parentMediaType: null,
    seriesItemId: null,
    seasonItemId: null,
    tmdbId: null,
    showTmdbId: 12345,
    seasonNumber: 1,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    title: 'Season 1',
    subtitle: null,
    summary: null,
    overview: null,
    tagline: null,
    artwork: { poster: null, backdrop: null, still: null },
    images: { poster: null, backdrop: null, logo: null, still: null },
    releaseDate: null,
    releaseYear: null,
    runtimeMinutes: null,
    rating: null,
    status: null,
    maturityRating: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    genres: [],
    externalIds: { tmdb: null, imdb: null, tvdb: null },
  }]) as any;
  t.after(() => {
    MetadataTitleExtrasService.prototype.getTitleExtrasInternal = original;
    MetadataCardService.prototype.buildCardViews = originalBuildCardViews;
  });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: `/v1/metadata/items/${SHOW_ITEM_ID}/extras?language=en-US`,
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.Seasons.length, 1);
  assert.equal(body.data.Seasons[0].parent.seasonNumber, 1);
  assert.equal(body.data.Reviews.length, 0);
  assert.equal(body.data.Similar.length, 0);
  assert.equal(body.data.Collection, null);
});

test('profile metadata ratings use itemId route params', async (t) => {
  const { MetadataRatingsService } = await import('../../modules/metadata/metadata-ratings.service.js');
  const originalRatings = MetadataRatingsService.prototype.getTitleRatings;
  const seen: string[] = [];

  MetadataRatingsService.prototype.getTitleRatings = (async (_userId: string, _profileId: string, itemId: string) => {
    seen.push(`ratings:${itemId}`);
    return { Ratings: { imdb: null, tmdb: null, trakt: null, metacritic: null, rottenTomatoes: null, audience: null, letterboxd: null, rogerEbert: null } };
  }) as any;
  t.after(() => {
    MetadataRatingsService.prototype.getTitleRatings = originalRatings;
  });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const ratings = await app.inject({
    method: 'GET',
    url: `/v1/profiles/profile-1/metadata/items/${MOVIE_ITEM_ID}/ratings`,
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(ratings.statusCode, 200);
  assert.deepEqual(seen, [
    `ratings:${MOVIE_ITEM_ID}`,
  ]);
});

test('/v1/playback/resolve requires itemId only', async (t) => {
  const { PlaybackResolveService } = await import('../../modules/metadata/playback-resolve.service.js');
  const { MetadataLanguageService } = await import('../../modules/metadata/metadata-language.service.js');
  const original = PlaybackResolveService.prototype.resolvePlayback;
  const originalResolveForAccount = MetadataLanguageService.prototype.resolveForAccount;
  let seenItemId: string | null = null;

  MetadataLanguageService.prototype.resolveForAccount = (async () => 'en-US') as any;
  PlaybackResolveService.prototype.resolvePlayback = (async ({ itemId }: { itemId: string }) => {
    seenItemId = itemId;
    return { Item: makeClientMediaCard(itemId), Show: null, Season: null };
  }) as any;
  t.after(() => {
    MetadataLanguageService.prototype.resolveForAccount = originalResolveForAccount;
    PlaybackResolveService.prototype.resolvePlayback = original;
  });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const successResponse = await app.inject({
    method: 'GET',
    url: `/v1/playback/resolve?itemId=${MOVIE_ITEM_ID}`,
    headers: { authorization: 'Bearer test' },
  });
  const missingItemId = await app.inject({
    method: 'GET',
    url: '/v1/playback/resolve',
    headers: { authorization: 'Bearer test' },
  });
  const invalidItemId = await app.inject({
    method: 'GET',
    url: '/v1/playback/resolve?itemId=not-a-public-item-id',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(successResponse.statusCode, 200);
  assert.equal(seenItemId, MOVIE_ITEM_ID);
  assert.equal(missingItemId.statusCode, 400);
  assert.equal(invalidItemId.statusCode, 400);
});

test('GET /v1/metadata/shows/:itemId/episodes serializes series Creators', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const original = MetadataDetailService.prototype.getSeriesEpisodes;
  MetadataDetailService.prototype.getSeriesEpisodes = (async () => ({
    Items: [makeEpisodeClientMediaCard()],
    StartIndex: 0,
    TotalRecordCount: 1,
    NextCursor: null,
    HasMore: false,
    Creators: [{
      personId: 'f137a2dd21bbc1b99aa5c0f6bf02a809',
      name: 'Jane Creator',
      role: 'Creator',
      department: 'Writing',
      profileUrl: null,
    }],
  })) as any;
  t.after(() => { MetadataDetailService.prototype.getSeriesEpisodes = original; });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: `/v1/metadata/shows/${SHOW_ITEM_ID}/episodes?language=en-US`,
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.Creators.length, 1);
  assert.equal(body.data.Creators[0].name, 'Jane Creator');
  assert.equal(body.data.Items[0].itemId, EPISODE_ITEM_ID);
});

test('GET /v1/metadata/items/:episodeItemId serializes series Creators on detail', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const original = MetadataDetailService.prototype.getItemDetail;
  MetadataDetailService.prototype.getItemDetail = (async () => ({
    ...makeTitleDetail(EPISODE_ITEM_ID),
    Item: makeEpisodeClientMediaCard(),
    Creators: [{
      personId: 'f137a2dd21bbc1b99aa5c0f6bf02a809',
      name: 'Jane Creator',
      role: 'Creator',
      department: 'Writing',
      profileUrl: null,
    }],
  })) as any;
  t.after(() => { MetadataDetailService.prototype.getItemDetail = original; });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: `/v1/metadata/items/${EPISODE_ITEM_ID}?language=en-US`,
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.Item.itemId, EPISODE_ITEM_ID);
  assert.equal(body.data.Creators.length, 1);
  assert.equal(body.data.Creators[0].name, 'Jane Creator');
});
