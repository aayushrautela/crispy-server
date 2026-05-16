import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv, buildTestApp } from '../../test-helpers.js';

seedTestEnv();

function makeMediaItem(key = 'movie:tmdb:694') {
  return {
    mediaKey: key,
    mediaType: 'movie',
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

function makeView() {
  return {
    mediaType: 'movie',
    kind: 'title',
    mediaKey: 'movie:tmdb:694',
    parentMediaType: null,
    tmdbId: 694,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    title: 'The Shining',
    subtitle: null,
    summary: null,
    overview: null,
    artwork: {
      poster: { small: null, medium: null, large: null },
      backdrop: { small: null, medium: null, large: null },
      still: { small: null, medium: null, large: null },
    },
    images: {
      poster: { small: null, medium: null, large: null },
      backdrop: { small: null, medium: null, large: null },
      still: { small: null, medium: null, large: null },
      logo: { small: null, medium: null, large: null },
    },
    releaseDate: null,
    releaseYear: null,
    runtimeMinutes: null,
    rating: null,
    status: null,
    maturityRating: null,
    certification: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    genres: [],
    externalIds: { tmdb: 694, imdb: 'tt0081505', tvdb: null },
    seasonCount: null,
    episodeCount: null,
    nextEpisode: null,
  };
}

test('GET /v1/metadata/titles/:mediaKey serializes collection with no parts', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    item: makeView(),
    seasons: [],
    nextEpisode: null,
    videos: [],
    cast: [],
    directors: [],
    creators: [],
    production: {
      originalLanguage: null,
      originCountries: [],
      spokenLanguages: [],
      productionCountries: [],
      companies: [],
      networks: [],
    },
    collection: {
      id: 123,
      provider: 'tmdb',
      providerId: '123',
      name: 'Test Collection',
      poster: { small: null, medium: null, large: null },
      backdrop: { small: null, medium: null, large: null },
      parts: [],
    },
    similar: [],
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
  assert.ok(body.data.collection);
  assert.equal(body.data.collection.name, 'Test Collection');
  assert.equal(body.data.collection.parts.length, 0);
});

test('GET /v1/metadata/titles/:mediaKey serializes null collection', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    item: makeView(),
    seasons: [],
    nextEpisode: null,
    videos: [],
    cast: [],
    directors: [],
    creators: [],
    production: {
      originalLanguage: null,
      originCountries: [],
      spokenLanguages: [],
      productionCountries: [],
      companies: [],
      networks: [],
    },
    collection: null,
    similar: [],
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
  assert.equal(response.json().data.collection, null);
});

test('GET /v1/metadata/titles/:mediaKey serializes show with nextEpisode', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    item: {
      ...makeView(),
      mediaType: 'show',
      mediaKey: 'show:tmdb:32726',
      tmdbId: 32726,
      showTmdbId: 32726,
      title: 'Bob\'s Burgers',
      nextEpisode: {
        mediaType: 'episode',
        mediaKey: 'episode:tmdb:32726:16:1',
        parentMediaType: 'show',
        tmdbId: 123456,
        showTmdbId: 32726,
        seasonNumber: 16,
        episodeNumber: 1,
        absoluteEpisodeNumber: null,
        title: 'Episode Title',
        summary: 'Episode summary',
        airDate: '2025-09-28',
        runtimeMinutes: 22,
        rating: 8.5,
        images: {
          poster: { small: null, medium: null, large: null },
          backdrop: { small: null, medium: null, large: null },
          still: { small: null, medium: null, large: null },
          logo: { small: null, medium: null, large: null },
        },
      },
    },
    seasons: [],
    nextEpisode: {
      mediaType: 'episode',
      mediaKey: 'episode:tmdb:32726:16:1',
      parentMediaType: 'show',
      tmdbId: 123456,
      showTmdbId: 32726,
      seasonNumber: 16,
      episodeNumber: 1,
      absoluteEpisodeNumber: null,
      title: 'Episode Title',
      summary: 'Episode summary',
      airDate: '2025-09-28',
      runtimeMinutes: 22,
      rating: 8.5,
      images: {
        poster: { small: null, medium: null, large: null },
        backdrop: { small: null, medium: null, large: null },
        still: { small: null, medium: null, large: null },
        logo: { small: null, medium: null, large: null },
      },
      showTitle: 'Bob\'s Burgers',
      showExternalIds: { tmdb: 32726, imdb: 'tt1561755', tvdb: null },
    },
    videos: [],
    cast: [],
    directors: [],
    creators: [],
    production: {
      originalLanguage: null,
      originCountries: [],
      spokenLanguages: [],
      productionCountries: [],
      companies: [],
      networks: [],
    },
    collection: null,
    similar: [],
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
  assert.ok(body.data.item.nextEpisode);
  assert.equal(body.data.item.nextEpisode.mediaKey, 'episode:tmdb:32726:16:1');
  assert.equal(body.data.item.nextEpisode.seasonNumber, 16);
  assert.equal(body.data.item.nextEpisode.episodeNumber, 1);
  assert.ok(body.data.item.nextEpisode.images);
});

test('GET /v1/metadata/titles/:mediaKey serializes movie with lightweight collection', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    item: makeView(),
    seasons: [],
    nextEpisode: null,
    videos: [],
    cast: [],
    directors: [],
    creators: [],
    production: {
      originalLanguage: null,
      originCountries: [],
      spokenLanguages: [],
      productionCountries: [],
      companies: [],
      networks: [],
    },
    collection: {
      id: 83533,
      provider: 'tmdb',
      providerId: '83533',
      name: 'Avatar Collection',
      poster: { small: null, medium: null, large: null },
      backdrop: { small: null, medium: null, large: null },
      parts: [],
    },
    similar: [],
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
  const body = response.json();
  assert.ok(body.data.collection);
  assert.equal(body.data.collection.name, 'Avatar Collection');
  assert.equal(body.data.collection.parts.length, 0);
  assert.equal(body.data.similar.length, 0);
});

test('GET /v1/metadata/titles/:mediaKey/extras serializes movie extras', async (t) => {
  const { MetadataTitleExtrasService } = await import('../../modules/metadata/metadata-title-extras.service.js');

  const original = MetadataTitleExtrasService.prototype.getTitleExtras;

  MetadataTitleExtrasService.prototype.getTitleExtras = (async () => ({
    episodes: [],
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
      {
        kind: 'metadata_detail',
        mediaItem: makeMediaItem('movie:tmdb:10195'),
        context: {},
        presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
      },
    ],
    collection: {
      id: 83533,
      provider: 'tmdb',
      providerId: '83533',
      name: 'Avatar Collection',
      poster: { small: null, medium: null, large: null },
      backdrop: { small: null, medium: null, large: null },
      parts: [
        {
          kind: 'metadata_detail',
          mediaItem: makeMediaItem('movie:tmdb:19995'),
          context: {},
          presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
        },
      ],
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
  assert.equal(body.data.episodes.length, 0);
  assert.equal(body.data.reviews.length, 1);
  assert.equal(body.data.reviews[0].id, 'rev-1');
  assert.equal(body.data.similar.length, 1);
  assert.equal(body.data.similar[0].mediaItem.mediaKey, 'movie:tmdb:10195');
  assert.ok(body.data.collection);
  assert.equal(body.data.collection.name, 'Avatar Collection');
  assert.equal(body.data.collection.parts.length, 1);
});

test('GET /v1/metadata/titles/:mediaKey/extras serializes show episodes', async (t) => {
  const { MetadataTitleExtrasService } = await import('../../modules/metadata/metadata-title-extras.service.js');

  const original = MetadataTitleExtrasService.prototype.getTitleExtras;

  MetadataTitleExtrasService.prototype.getTitleExtras = (async () => ({
    episodes: [
      {
        mediaType: 'episode',
        mediaKey: 'episode:tmdb:32726:1:1',
        parentMediaType: 'show',
        tmdbId: 1001,
        showTmdbId: 32726,
        seasonNumber: 1,
        episodeNumber: 1,
        absoluteEpisodeNumber: null,
        title: 'Pilot',
        summary: 'The first episode',
        airDate: '2024-01-01',
        runtimeMinutes: 30,
        rating: 8.0,
        images: {
          poster: { small: null, medium: null, large: null },
          backdrop: { small: null, medium: null, large: null },
          still: { small: null, medium: null, large: null },
          logo: { small: null, medium: null, large: null },
        },
        showTitle: 'Test Show',
        showExternalIds: { tmdb: 32726, imdb: 'tt1234567', tvdb: null },
      },
      {
        mediaType: 'episode',
        mediaKey: 'episode:tmdb:32726:1:2',
        parentMediaType: 'show',
        tmdbId: 1002,
        showTmdbId: 32726,
        seasonNumber: 1,
        episodeNumber: 2,
        absoluteEpisodeNumber: null,
        title: 'Second Episode',
        summary: 'The second episode',
        airDate: '2024-01-08',
        runtimeMinutes: 30,
        rating: 7.5,
        images: {
          poster: { small: null, medium: null, large: null },
          backdrop: { small: null, medium: null, large: null },
          still: { small: null, medium: null, large: null },
          logo: { small: null, medium: null, large: null },
        },
        showTitle: 'Test Show',
        showExternalIds: { tmdb: 32726, imdb: 'tt1234567', tvdb: null },
      },
    ],
    reviews: [],
    similar: [],
    collection: null,
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
  assert.equal(body.data.episodes.length, 2);
  assert.equal(body.data.episodes[0].episodeNumber, 1);
  assert.equal(body.data.episodes[1].episodeNumber, 2);
  assert.equal(body.data.episodes[0].showTitle, 'Test Show');
  assert.equal(body.data.reviews.length, 0);
  assert.equal(body.data.similar.length, 0);
  assert.equal(body.data.collection, null);
});
