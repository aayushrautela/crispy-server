import assert from 'node:assert/strict';
import test from 'node:test';
import { metadataCardToMediaItem, metadataViewToMediaItem, watchCacheRecordToMediaItem } from './media-item.mapper.js';
import type { MetadataCardView } from './metadata-card.types.js';
import type { MetadataView } from './metadata-detail.types.js';
import type { WatchMediaCardCacheRecord } from '../watch/watch-media-card-cache.repo.js';

const imageSet = (value: string | null) => ({ small: value, medium: value, large: value });

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
    poster: imageSet('poster.jpg'),
    backdrop: imageSet('backdrop.jpg'),
    still: imageSet(null),
  },
  images: {
    poster: imageSet('poster.jpg'),
    backdrop: imageSet('backdrop.jpg'),
    still: imageSet(null),
    logo: imageSet('logo.png'),
  },
  releaseDate: '2024-01-01',
  releaseYear: 2024,
  runtimeMinutes: 120,
  rating: 8.1,
  status: 'Released',
  maturityRating: 'PG-13',
  trailerUrl: null,
  trailerThumbnailUrl: null,
  posterColor: null,
  backdropColor: null,
  genres: [],
};

test('metadataCardToMediaItem maps common metadata with artwork fallbacks', () => {
  const item = metadataCardToMediaItem(baseCard);

  assert.equal(item.mediaKey, 'movie:tmdb:1');
  assert.equal(item.mediaType, 'movie');
  assert.equal(item.title, 'Movie');
  assert.equal(item.overview, 'Summary');
  assert.equal(item.images.poster.small, 'poster.jpg');
  assert.equal(item.images.poster.medium, 'poster.jpg');
  assert.equal(item.images.poster.large, 'poster.jpg');
  assert.equal(item.images.backdrop.small, 'backdrop.jpg');
  assert.equal(item.images.backdrop.medium, 'backdrop.jpg');
  assert.equal(item.images.backdrop.large, 'backdrop.jpg');
  assert.equal(item.images.logo.small, 'logo.png');
  assert.equal(item.images.logo.medium, 'logo.png');
  assert.equal(item.images.logo.large, 'logo.png');
  assert.equal(item.maturityRating, 'PG-13');
  assert.equal(item.certification, 'PG-13');
  assert.deepEqual(item.externalIds, { tmdb: 1, imdb: null, tvdb: null });
  assert.deepEqual(item.genres, []);
});

test('metadataCardToMediaItem uses Untitled title fallback and null artwork', () => {
  const item = metadataCardToMediaItem({
    ...baseCard,
    title: null,
    artwork: { poster: imageSet(null), backdrop: imageSet(null), still: imageSet(null) },
    images: { poster: imageSet(null), backdrop: imageSet(null), still: imageSet(null), logo: imageSet(null) },
  });

  assert.equal(item.title, 'Untitled');
  assert.deepEqual(item.images.poster, imageSet(null));
  assert.deepEqual(item.images.backdrop, imageSet(null));
  assert.deepEqual(item.images.logo, imageSet(null));
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
    trailerUrl: 'https://youtube.test/watch?v=abc',
    trailerThumbnailUrl: 'https://youtube.test/thumb.jpg',
    posterColor: '#111111',
    backdropColor: '#222222',
    releaseYear: 2024,
    rating: 7.5,
    maturityRating: 'TV-MA',
    genres: ['Drama'],
  };

  const item = watchCacheRecordToMediaItem(record, { seasonNumber: 1, episodeNumber: 2 });

  assert.equal(item.mediaType, 'episode');
  assert.equal(item.title, 'Show');
  assert.deepEqual(item.images.poster, imageSet(null));
  assert.deepEqual(item.images.backdrop, { small: 'https://image.tmdb.org/t/p/w300backdrop.jpg', medium: 'https://image.tmdb.org/t/p/w780backdrop.jpg', large: 'https://image.tmdb.org/t/p/w1280backdrop.jpg' });
  assert.deepEqual(item.images.logo, { small: 'https://image.tmdb.org/t/p/w185logo.png', medium: 'https://image.tmdb.org/t/p/w300logo.png', large: 'https://image.tmdb.org/t/p/w500logo.png' });
  assert.equal(item.maturityRating, 'TV-MA');
  assert.equal(item.certification, 'TV-MA');
  assert.equal(item.trailerUrl, 'https://youtube.test/watch?v=abc');
  assert.equal(item.trailerThumbnailUrl, 'https://youtube.test/thumb.jpg');
  assert.equal(item.posterColor, '#111111');
  assert.equal(item.backdropColor, '#222222');
  assert.deepEqual(item.genres, ['Drama']);
  assert.equal(item.seasonNumber, 1);
  assert.equal(item.episodeNumber, 2);
});


