import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('buildMetadataCardView for episode uses show title and episode subtitle', async () => {
  const { buildMetadataCardView } = await import('./metadata-card.builders.js');

  const view = buildMetadataCardView({
    identity: { mediaKey: 'episode:tmdb:42:1:2', mediaType: 'episode', tmdbId: null, showTmdbId: 42, seasonNumber: 1, episodeNumber: 2 },
    title: {
      mediaType: 'tv', tmdbId: 42, name: 'Breaking Point', originalName: 'Breaking Point',
      overview: 'A thrilling drama.', releaseDate: null, firstAirDate: '2024-01-01',
      status: 'Returning Series', posterPath: '/poster.jpg', backdropPath: '/backdrop.jpg',
      runtime: null, episodeRunTime: [45], numberOfSeasons: 3, numberOfEpisodes: 30,
      externalIds: {}, raw: { genres: [], vote_average: 8.0 },
      fetchedAt: '2026-03-22T00:00:00.000Z', expiresAt: '2026-03-23T00:00:00.000Z',
    },
    currentEpisode: {
      showTmdbId: 42, seasonNumber: 1, episodeNumber: 2, tmdbId: 554,
      name: 'Previous Episode', overview: 'Previous.', airDate: '2024-01-08',
      runtime: 45, stillPath: '/prev.jpg', voteAverage: 7.8, raw: {},
      fetchedAt: '2026-03-22T00:00:00.000Z', expiresAt: '2026-03-23T00:00:00.000Z',
    },
  });

  assert.equal(view.mediaType, 'episode');
  assert.equal(view.provider, 'tmdb');
  assert.equal(view.providerId, '42');
  assert.equal(view.kind, 'episode');
  assert.equal(view.title, 'Breaking Point');
  assert.equal(view.subtitle, 'Previous Episode');
  assert.equal(view.summary, 'Previous.');
});

test('buildEpisodePreview produces provider-based payload', async () => {
  const { buildEpisodePreview } = await import('./metadata-card.builders.js');

  const preview = buildEpisodePreview(
    {
      mediaType: 'tv', tmdbId: 42, name: 'Test Show', originalName: 'Test Show',
      overview: null, releaseDate: null, firstAirDate: null, status: null,
      posterPath: '/poster.jpg', backdropPath: null, runtime: null, episodeRunTime: [],
      numberOfSeasons: null, numberOfEpisodes: null, externalIds: {}, raw: {},
      fetchedAt: '', expiresAt: '',
    },
    {
      showTmdbId: 42, seasonNumber: 1, episodeNumber: 3, tmdbId: 555,
      name: 'Episode 3', overview: 'Overview.', airDate: '2024-01-15',
      runtime: 47, stillPath: '/still.jpg', voteAverage: 8.1, raw: {},
      fetchedAt: '2026-03-22T00:00:00.000Z', expiresAt: '2026-03-23T00:00:00.000Z',
    },
  );

  assert.equal(preview.mediaType, 'episode');
  assert.equal(preview.provider, 'tmdb');
  assert.equal(preview.providerId, '42:s1:e3');
  assert.equal(preview.showTmdbId, 42);
  assert.equal(preview.seasonNumber, 1);
  assert.equal(preview.episodeNumber, 3);
  assert.equal(preview.airDate, '2024-01-15');
  assert.equal(preview.runtimeMinutes, 47);
  assert.equal(preview.rating, 8.1);
  assert.equal(preview.images.stillUrl, 'https://image.tmdb.org/t/p/w500/still.jpg');
});
