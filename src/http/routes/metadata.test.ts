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
    genres: [],
    externalIds: { tmdb: 694, imdb: 'tt0081505', tvdb: null },
    seasonCount: null,
    episodeCount: null,
    nextEpisode: null,
  };
}

test('GET /v1/metadata/titles/:mediaKey serializes collection with parts', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    item: makeView(),
    seasons: [],
    episodes: [],
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
      parts: [
        {
          kind: 'metadata_detail',
          mediaItem: makeMediaItem('movie:tmdb:1'),
          context: {},
          presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
        },
      ],
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
    url: '/v1/metadata/titles/movie:tmdb:694',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.data.collection);
  assert.equal(body.data.collection.parts.length, 1);
  assert.equal(body.data.collection.parts[0].kind, 'metadata_detail');
  assert.equal(body.data.collection.parts[0].mediaItem.mediaKey, 'movie:tmdb:1');
});

test('GET /v1/metadata/titles/:mediaKey serializes null collection', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    item: makeView(),
    seasons: [],
    episodes: [],
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
    url: '/v1/metadata/titles/movie:tmdb:694',
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
    episodes: [],
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
    url: '/v1/metadata/titles/show:tmdb:32726',
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

test('GET /v1/metadata/titles/:mediaKey serializes movie with collection and similar', async (t) => {
  const { MetadataDetailService } = await import('../../modules/metadata/metadata-detail.service.js');

  const original = MetadataDetailService.prototype.getTitleDetailById;

  MetadataDetailService.prototype.getTitleDetailById = (async () => ({
    item: makeView(),
    seasons: [],
    episodes: [],
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
      parts: [
        {
          kind: 'metadata_detail',
          mediaItem: makeMediaItem('movie:tmdb:19995'),
          context: {},
          presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
        },
        {
          kind: 'metadata_detail',
          mediaItem: makeMediaItem('movie:tmdb:76600'),
          context: {},
          presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
        },
      ],
    },
    similar: [
      {
        kind: 'metadata_detail',
        mediaItem: makeMediaItem('movie:tmdb:10195'),
        context: {},
        presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
      },
    ],
  })) as any;

  t.after(() => {
    MetadataDetailService.prototype.getTitleDetailById = original;
  });

  const { registerMetadataRoutes } = await import('./metadata.js');
  const app = await buildTestApp(registerMetadataRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metadata/titles/movie:tmdb:83533',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.data.collection);
  assert.equal(body.data.collection.name, 'Avatar Collection');
  assert.equal(body.data.collection.parts.length, 2);
  assert.equal(body.data.collection.parts[0].kind, 'metadata_detail');
  assert.equal(body.data.collection.parts[0].mediaItem.mediaKey, 'movie:tmdb:19995');
  assert.equal(body.data.similar.length, 1);
  assert.equal(body.data.similar[0].kind, 'metadata_detail');
  assert.equal(body.data.similar[0].mediaItem.mediaKey, 'movie:tmdb:10195');
});
