import assert from 'node:assert/strict';
import test from 'node:test';
import { metadataCardToMediaItem } from './media-item.mapper.js';
import type { MetadataCardView } from './metadata-card.types.js';

const imageSet = (value: string | null) => ({ small: value, medium: value, large: value });

const baseCard: MetadataCardView = {
  mediaType: 'movie',
  kind: 'title',
  itemId: 'f137a2dd21bbc1b99aa5c0f6bf02a805',
  parentMediaType: null,
  seriesItemId: null,
  seasonItemId: null,
  tmdbId: 1,
  showTmdbId: null,
  seasonNumber: null,
  episodeNumber: null,
  absoluteEpisodeNumber: null,
  title: 'Movie',
  subtitle: null,
  summary: 'Summary',
  overview: null,
  tagline: null,
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

  assert.equal(item.itemId, 'f137a2dd21bbc1b99aa5c0f6bf02a805');
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
    itemId: 'f137a2dd21bbc1b99aa5c0f6bf02a807',
    title: 'Episode title',
    seriesItemId: 'f137a2dd21bbc1b99aa5c0f6bf02a806',
    seasonItemId: 'f137a2dd21bbc1b99aa5c0f6bf02a808',
    seasonNumber: 1,
    episodeNumber: 2,
    absoluteEpisodeNumber: 2,
  });

  assert.equal(item.episodeTitle, 'Episode title');
  assert.equal(item.airDate, '2024-01-01');
  assert.equal(item.seriesItemId, 'f137a2dd21bbc1b99aa5c0f6bf02a806');
  assert.equal(item.seasonItemId, 'f137a2dd21bbc1b99aa5c0f6bf02a808');
  assert.equal(item.seasonNumber, 1);
  assert.equal(item.episodeNumber, 2);
});



