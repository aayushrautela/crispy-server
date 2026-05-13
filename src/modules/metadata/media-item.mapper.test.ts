import assert from 'node:assert/strict';
import test from 'node:test';
import { metadataCardToMediaItem, metadataViewToMediaItem, watchCacheRecordToMediaItem } from './media-item.mapper.js';
import type { MetadataCardView } from './metadata-card.types.js';
import type { MetadataView } from './metadata-detail.types.js';
import type { WatchMediaCardCacheRecord } from '../watch/watch-media-card-cache.repo.js';

const baseCard: MetadataCardView = {
  mediaType: 'movie',
  kind: 'title',
  mediaKey: 'movie:tmdb:1',
  parentMediaType: null,
  tmdbId: 1,
  showTmdbId: null,
  seasonNumber: null,
  episodeNumber: null,
  absoluteEpisodeNumber: null,
  title: 'Movie',
  subtitle: null,
  summary: 'Summary',
  overview: null,
  artwork: {
    posterUrl: 'poster.jpg',
    backdropUrl: 'backdrop.jpg',
    stillUrl: null,
  },
  images: {
    posterUrl: null,
    backdropUrl: null,
    stillUrl: null,
    logoUrl: 'logo.png',
  },
  releaseDate: '2024-01-01',
  releaseYear: 2024,
  runtimeMinutes: 120,
  rating: 8.1,
  status: 'Released',
  maturityRating: 'PG-13',
};

test('metadataCardToMediaItem maps common metadata with artwork fallbacks', () => {
  const item = metadataCardToMediaItem(baseCard);

  assert.equal(item.mediaKey, 'movie:tmdb:1');
  assert.equal(item.mediaType, 'movie');
  assert.equal(item.title, 'Movie');
  assert.equal(item.overview, 'Summary');
  assert.equal(item.posterUrl, 'poster.jpg');
  assert.equal(item.backdropUrl, 'backdrop.jpg');
  assert.equal(item.logoUrl, 'logo.png');
  assert.equal(item.maturityRating, 'PG-13');
  assert.equal(item.certification, 'PG-13');
  assert.deepEqual(item.externalIds, { tmdb: 1, imdb: null, tvdb: null });
  assert.deepEqual(item.genres, []);
});

test('metadataCardToMediaItem uses Untitled title fallback and null artwork', () => {
  const item = metadataCardToMediaItem({
    ...baseCard,
    title: null,
    artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
    images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
  });

  assert.equal(item.title, 'Untitled');
  assert.equal(item.posterUrl, null);
  assert.equal(item.backdropUrl, null);
  assert.equal(item.logoUrl, null);
});

test('metadataCardToMediaItem maps episode fields', () => {
  const item = metadataCardToMediaItem({
    ...baseCard,
    mediaType: 'episode',
    kind: 'episode',
    mediaKey: 'episode:tmdb:1:1:2',
    title: 'Episode title',
    showTmdbId: 1,
    seasonNumber: 1,
    episodeNumber: 2,
    absoluteEpisodeNumber: 2,
  });

  assert.equal(item.episodeTitle, 'Episode title');
  assert.equal(item.airDate, '2024-01-01');
  assert.equal(item.showTmdbId, 1);
  assert.equal(item.seasonNumber, 1);
  assert.equal(item.episodeNumber, 2);
});

test('metadataViewToMediaItem maps detail-only metadata', () => {
  const view: MetadataView = {
    ...baseCard,
    certification: 'PG-13',
    genres: ['Drama'],
    externalIds: { tmdb: 1, imdb: 'tt1', tvdb: 2 },
    seasonCount: null,
    episodeCount: null,
    nextEpisode: null,
  };

  const item = metadataViewToMediaItem(view);

  assert.equal(item.maturityRating, 'PG-13');
  assert.equal(item.certification, 'PG-13');
  assert.deepEqual(item.genres, ['Drama']);
  assert.deepEqual(item.externalIds, { tmdb: 1, imdb: 'tt1', tvdb: 2 });
});

test('watchCacheRecordToMediaItem maps cache records with fallback', () => {
  const record: WatchMediaCardCacheRecord = {
    mediaKey: 'episode:tmdb:1:1:2',
    mediaType: 'episode',
    titleProvider: 'tmdb',
    titleProviderId: '1',
    titleMediaType: 'show',
    title: 'Show',
    subtitle: 'S1 E2',
    posterUrl: null,
    backdropUrl: 'backdrop.jpg',
    logoUrl: 'logo.png',
    releaseYear: 2024,
    rating: 7.5,
    maturityRating: 'TV-MA',
  };

  const item = watchCacheRecordToMediaItem(record, { seasonNumber: 1, episodeNumber: 2 });

  assert.equal(item.mediaType, 'episode');
  assert.equal(item.title, 'Show');
  assert.equal(item.posterUrl, null);
  assert.equal(item.backdropUrl, 'backdrop.jpg');
  assert.equal(item.logoUrl, 'logo.png');
  assert.equal(item.maturityRating, 'TV-MA');
  assert.equal(item.certification, 'TV-MA');
  assert.equal(item.seasonNumber, 1);
  assert.equal(item.episodeNumber, 2);
});


