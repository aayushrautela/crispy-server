import test from 'node:test';
import assert from 'node:assert/strict';
import { findNextEpisode, episodeViewToLookup } from './next-episode.js';

test('findNextEpisode returns first unwatched episode after current', () => {
  const episodes = [
    { seasonNumber: 1, episodeNumber: 1, title: 'Ep 1', releaseDate: '2024-01-01' },
    { seasonNumber: 1, episodeNumber: 2, title: 'Ep 2', releaseDate: '2024-01-08' },
    { seasonNumber: 1, episodeNumber: 3, title: 'Ep 3', releaseDate: '2024-01-15' },
    { seasonNumber: 2, episodeNumber: 1, title: 'Ep 4', releaseDate: '2024-02-01' },
  ];

  const result = findNextEpisode({
    currentSeasonNumber: 1,
    currentEpisodeNumber: 1,
    episodes,
    nowMs: Date.parse('2024-02-01T00:00:00.000Z'),
  });

  assert.equal(result?.title, 'Ep 2');
});

test('findNextEpisode skips watched episodes', () => {
  const episodes = [
    { seasonNumber: 1, episodeNumber: 1, title: 'Ep 1', releaseDate: '2024-01-01' },
    { seasonNumber: 1, episodeNumber: 2, title: 'Ep 2', releaseDate: '2024-01-08' },
    { seasonNumber: 1, episodeNumber: 3, title: 'Ep 3', releaseDate: '2024-01-15' },
  ];

  const result = findNextEpisode({
    currentSeasonNumber: 1,
    currentEpisodeNumber: 1,
    episodes,
    watchedKeys: ['tt123:1:2'],
    showId: 'tt123',
    nowMs: Date.parse('2024-02-01T00:00:00.000Z'),
  });

  assert.equal(result?.title, 'Ep 3');
});

test('findNextEpisode skips unreleased episodes', () => {
  const episodes = [
    { seasonNumber: 1, episodeNumber: 1, title: 'Ep 1', releaseDate: '2024-01-01' },
    { seasonNumber: 1, episodeNumber: 2, title: 'Ep 2', releaseDate: '2024-12-01' },
    { seasonNumber: 1, episodeNumber: 3, title: 'Ep 3', releaseDate: '2024-01-15' },
  ];

  const result = findNextEpisode({
    currentSeasonNumber: 1,
    currentEpisodeNumber: 1,
    episodes,
    nowMs: Date.parse('2024-06-01T00:00:00.000Z'),
  });

  assert.equal(result?.title, 'Ep 3');
});

test('findNextEpisode returns null when no next episode exists', () => {
  const episodes = [
    { seasonNumber: 1, episodeNumber: 1, title: 'Ep 1', releaseDate: '2024-01-01' },
  ];

  const result = findNextEpisode({
    currentSeasonNumber: 1,
    currentEpisodeNumber: 1,
    episodes,
    nowMs: Date.parse('2024-06-01T00:00:00.000Z'),
  });

  assert.equal(result, null);
});

test('findNextEpisode handles cross-season transitions', () => {
  const episodes = [
    { seasonNumber: 1, episodeNumber: 10, title: 'S1E10', releaseDate: '2024-01-01' },
    { seasonNumber: 2, episodeNumber: 1, title: 'S2E1', releaseDate: '2024-02-01' },
    { seasonNumber: 2, episodeNumber: 2, title: 'S2E2', releaseDate: '2024-02-08' },
  ];

  const result = findNextEpisode({
    currentSeasonNumber: 1,
    currentEpisodeNumber: 10,
    episodes,
    nowMs: Date.parse('2024-03-01T00:00:00.000Z'),
  });

  assert.equal(result?.title, 'S2E1');
});

test('findNextEpisode skips episodes with no release date', () => {
  const episodes = [
    { seasonNumber: 1, episodeNumber: 1, title: 'Ep 1', releaseDate: '2024-01-01' },
    { seasonNumber: 1, episodeNumber: 2, title: 'Ep 2', releaseDate: null },
    { seasonNumber: 1, episodeNumber: 3, title: 'Ep 3', releaseDate: '2024-01-15' },
  ];

  const result = findNextEpisode({
    currentSeasonNumber: 1,
    currentEpisodeNumber: 1,
    episodes,
    nowMs: Date.parse('2024-02-01T00:00:00.000Z'),
  });

  assert.equal(result?.title, 'Ep 3');
});

test('episodeViewToLookup extracts episode-like fields from ClientMediaCard', () => {
  const episode = {
    itemId: 'episode:tmdb:42:1:3',
    mediaType: 'episode' as const,
    title: 'Episode 3',
    overview: null,
    year: null,
    releaseDate: '2024-01-15',
    rating: null,
    maturityRating: null,
    genres: [],
    runtimeSeconds: null,
    images: { artwork: null, logo: null, still: null },
    trailerUrl: null,
    progress: null,
    parent: {
      seriesItemId: 'show:tmdb:42',
      seasonItemId: 'season:tmdb:42:1',
      seasonNumber: 1,
      episodeNumber: 3,
    },
    providerIds: { tmdb: null, imdb: null, tvdb: null },
  };

  const lookup = episodeViewToLookup(episode);
  assert.equal(lookup.seasonNumber, 1);
  assert.equal(lookup.episodeNumber, 3);
  assert.equal(lookup.title, 'Episode 3');
  assert.equal(lookup.releaseDate, '2024-01-15');
});
