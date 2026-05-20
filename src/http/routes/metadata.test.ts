import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv();

const MOVIE_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a805';
const SHOW_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a806';
const EPISODE_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a807';
const SEASON_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a808';

function makeMediaItem(id = MOVIE_ITEM_ID) {
  return {
    Id: id,
    Type: id === SHOW_ITEM_ID ? 'Series' : id === EPISODE_ITEM_ID ? 'Episode' : id === SEASON_ITEM_ID ? 'Season' : 'Movie',
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
      Primary: null,
      Backdrop: [],
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

function makeEpisodeBaseItemDto(overrides?: Record<string, unknown>) {
  return {
    ...makeMediaItem(EPISODE_ITEM_ID),
    Type: 'Episode',
    Name: 'Episode Title',
    ParentImageTags: { Primary: null, Backdrop: [], Logo: null, Thumb: null },
    SeriesId: SHOW_ITEM_ID,
    SeriesName: "Bob's Burgers",
    SeasonId: SEASON_ITEM_ID,
    SeasonName: 'Season 16',
    ParentIndexNumber: 16,
    IndexNumber: 1,
    EpisodeTitle: 'Episode Title',
    AirDate: '2025-09-28',
    ...overrides,
  };
}

function makeTitleDetail(itemId = MOVIE_ITEM_ID) {
  return {
    Item: makeMediaItem(itemId),
    NextEpisode: null,
    Videos: [],
    Cast: [],
    Directors: [],
    Creators: [],
    Production: {
      originalLanguage: null,
      originCountries: [],
      spokenLanguages: [],
      productionCountries: [],
      companies: [],
      networks: [],
    },
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
  assert.equal(body.data.Item.Id, MOVIE_ITEM_ID);
});

test('GET /v1/metadata/items/:itemId serializes show with nextEpisode', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');
  const original = MetadataDetailService.prototype.getItemDetail;

  MetadataDetailService.prototype.getItemDetail = (async () => ({
    ...makeTitleDetail(SHOW_ITEM_ID),
    Item: makeMediaItem(SHOW_ITEM_ID),
    NextEpisode: makeEpisodeBaseItemDto(),
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
  assert.equal(body.data.NextEpisode.Id, EPISODE_ITEM_ID);
  assert.equal(body.data.NextEpisode.SeriesId, SHOW_ITEM_ID);
  assert.equal(body.data.NextEpisode.SeasonId, SEASON_ITEM_ID);
  assert.equal(body.data.NextEpisode.ParentIndexNumber, 16);
  assert.equal(body.data.NextEpisode.IndexNumber, 1);
  assert.ok(body.data.NextEpisode.ImageTags);
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
  const { MetadataTitleExtrasService } = await import('../../modules/metadata/metadata-title-extras.service.js');
  const original = MetadataTitleExtrasService.prototype.getTitleExtras;

  MetadataTitleExtrasService.prototype.getTitleExtras = (async () => ({
    Seasons: [],
    Episodes: [],
    Reviews: [
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
    Similar: [makeMediaItem('f137a2dd21bbc1b99aa5c0f6bf02a809')],
    Collection: {
      Items: [makeMediaItem('f137a2dd21bbc1b99aa5c0f6bf02a80a')],
      StartIndex: 0,
      TotalRecordCount: 1,
      NextCursor: null,
      HasMore: false,
    },
  })) as any;
  t.after(() => {
    MetadataTitleExtrasService.prototype.getTitleExtras = original;
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
  assert.equal(body.data.Episodes.length, 0);
  assert.equal(body.data.Reviews.length, 1);
  assert.equal(body.data.Reviews[0].id, 'rev-1');
  assert.equal(body.data.Similar.length, 1);
  assert.equal(body.data.Similar[0].Id, 'f137a2dd21bbc1b99aa5c0f6bf02a809');
  assert.ok(body.data.Collection);
  assert.equal(body.data.Collection.Items.length, 1);
});

test('GET /v1/metadata/items/:itemId/extras serializes show episodes', async (t) => {
  const { MetadataTitleExtrasService } = await import('../../modules/metadata/metadata-title-extras.service.js');
  const original = MetadataTitleExtrasService.prototype.getTitleExtras;

  MetadataTitleExtrasService.prototype.getTitleExtras = (async () => ({
    Seasons: [
      makeEpisodeBaseItemDto({ Id: 'f137a2dd21bbc1b99aa5c0f6bf02a801', Type: 'Season', Name: 'Season 1', ParentIndexNumber: null, IndexNumber: 1 }),
    ],
    Episodes: [
      makeEpisodeBaseItemDto({ Id: 'f137a2dd21bbc1b99aa5c0f6bf02a80b', Name: 'Pilot', EpisodeTitle: 'Pilot', AirDate: '2024-01-01', ParentIndexNumber: 1, IndexNumber: 1 }),
      makeEpisodeBaseItemDto({ Id: 'f137a2dd21bbc1b99aa5c0f6bf02a80c', Name: 'Second Episode', EpisodeTitle: 'Second Episode', AirDate: '2024-01-08', ParentIndexNumber: 1, IndexNumber: 2 }),
    ],
    Reviews: [],
    Similar: [],
    Collection: null,
  })) as any;
  t.after(() => {
    MetadataTitleExtrasService.prototype.getTitleExtras = original;
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
  assert.equal(body.data.Seasons[0].ParentIndexNumber, null);
  assert.equal(body.data.Seasons[0].IndexNumber, 1);
  assert.equal(body.data.Episodes.length, 2);
  assert.equal(body.data.Episodes[0].IndexNumber, 1);
  assert.equal(body.data.Episodes[1].IndexNumber, 2);
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
    return { Item: makeMediaItem(itemId), Show: null, Season: null };
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
