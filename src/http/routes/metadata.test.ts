import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv();

function makeMediaItem(key = 'movie:tmdb:694') {
  const [, mediaType] = key.split(':');
  return {
    Id: key,
    Type: mediaType === 'show' ? 'Series' : mediaType === 'movie' ? 'Movie' : mediaType === 'season' ? 'Season' : mediaType === 'episode' ? 'Episode' : 'Movie',
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
    Id: 'episode:tmdb:32726:16:1',
    Type: 'Episode',
    Name: 'Episode Title',
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
    ProviderIds: { Tmdb: '32726', Imdb: null, Tvdb: null },
    ImageTags: {
      Primary: null,
      Backdrop: [],
      Logo: null,
      Thumb: null,
      Screenshot: [],
    },
    ParentImageTags: { Primary: null, Backdrop: [], Logo: null, Thumb: null },
    SeriesId: null,
    SeriesName: null,
    SeasonId: null,
    SeasonName: null,
    ParentIndexNumber: 16,
    IndexNumber: 1,
    AbsoluteIndexNumber: null,
    EpisodeTitle: 'Episode Title',
    AirDate: '2025-09-28',
    RemoteTrailers: [],
    PosterColor: null,
    BackdropColor: null,
    UserData: null,
    ...overrides,
  };
}

test('GET /v1/metadata/titles/:mediaKey serializes collection with no parts', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    Item: makeMediaItem(),
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
  })) as any;

  t.after(() => {
    MetadataDetailService.prototype.getTitleDetailById = original;
  });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metadata/titles/movie:tmdb:694?language=en-US',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.collection, undefined);
});

test('GET /v1/metadata/titles/:mediaKey serializes null collection', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    Item: makeMediaItem(),
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
  })) as any;

  t.after(() => {
    MetadataDetailService.prototype.getTitleDetailById = original;
  });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metadata/titles/movie:tmdb:694?language=en-US',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.collection, undefined);
});

test('GET /v1/metadata/titles/:mediaKey serializes show with nextEpisode', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    Item: {
      ...makeEpisodeBaseItemDto({ Id: 'show:tmdb:32726', Type: 'Series', Name: "Bob's Burgers", EpisodeTitle: null, AirDate: null, ParentIndexNumber: null, IndexNumber: null }),
    },
    NextEpisode: makeEpisodeBaseItemDto(),
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
  })) as any;

  t.after(() => {
    MetadataDetailService.prototype.getTitleDetailById = original;
  });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metadata/titles/show:tmdb:32726?language=en-US',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.data.NextEpisode);
  assert.equal(body.data.NextEpisode.Id, 'episode:tmdb:32726:16:1');
  assert.equal(body.data.NextEpisode.ParentIndexNumber, 16);
  assert.equal(body.data.NextEpisode.IndexNumber, 1);
  assert.ok(body.data.NextEpisode.ImageTags);
});

test('GET /v1/metadata/titles/:mediaKey serializes movie', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    Item: makeMediaItem(),
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
  })) as any;

  t.after(() => {
    MetadataDetailService.prototype.getTitleDetailById = original;
  });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metadata/titles/movie:tmdb:83533?language=en-US',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
});

test('GET /v1/metadata/titles/:mediaKey/extras serializes movie extras', async (t) => {
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
    Similar: [
      makeMediaItem('movie:tmdb:10195'),
    ],
    Collection: {
      Items: [makeMediaItem('movie:tmdb:19995')],
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
    url: '/v1/metadata/titles/movie:tmdb:83533/extras?language=en-US',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.Episodes.length, 0);
  assert.equal(body.data.Reviews.length, 1);
  assert.equal(body.data.Reviews[0].id, 'rev-1');
  assert.equal(body.data.Similar.length, 1);
  assert.equal(body.data.Similar[0].Id, 'movie:tmdb:10195');
  assert.ok(body.data.Collection);
  assert.equal(body.data.Collection.Items.length, 1);
});

test('GET /v1/metadata/titles/:mediaKey/extras serializes show episodes', async (t) => {
  const { MetadataTitleExtrasService } = await import('../../modules/metadata/metadata-title-extras.service.js');

  const original = MetadataTitleExtrasService.prototype.getTitleExtras;

  MetadataTitleExtrasService.prototype.getTitleExtras = (async () => ({
    Seasons: [],
    Episodes: [
      makeEpisodeBaseItemDto({ Id: 'episode:tmdb:32726:1:1', Name: 'Pilot', EpisodeTitle: 'Pilot', AirDate: '2024-01-01', ParentIndexNumber: 1, IndexNumber: 1 }),
      makeEpisodeBaseItemDto({ Id: 'episode:tmdb:32726:1:2', Name: 'Second Episode', EpisodeTitle: 'Second Episode', AirDate: '2024-01-08', ParentIndexNumber: 1, IndexNumber: 2 }),
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
    url: '/v1/metadata/titles/show:tmdb:32726/extras?language=en-US',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.Episodes.length, 2);
  assert.equal(body.data.Episodes[0].IndexNumber, 1);
  assert.equal(body.data.Episodes[1].IndexNumber, 2);
  assert.equal(body.data.Reviews.length, 0);
  assert.equal(body.data.Similar.length, 0);
  assert.equal(body.data.Collection, null);
});
