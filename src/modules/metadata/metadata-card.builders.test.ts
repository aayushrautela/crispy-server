import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('buildMetadataCardView for episode uses episode title and show subtitle', async () => {
  const { buildMetadataCardView } = await import('./metadata-card.builders.js');

  const view = buildMetadataCardView({
    identity: { mediaKey: 'episode:tmdb:42:1:2', mediaType: 'episode', tmdbId: null, showTmdbId: 42, seasonNumber: 1, episodeNumber: 2 },
    title: {
      mediaType: 'tv', tmdbId: 42, language: 'en', name: 'Breaking Point', originalName: 'Breaking Point',
      overview: 'A thrilling drama.', tagline: null, releaseDate: null, firstAirDate: '2024-01-01',
      status: 'Returning Series', posterPath: '/poster.jpg', backdropPath: '/backdrop.jpg',
      runtime: null, episodeRunTime: [45], numberOfSeasons: 3, numberOfEpisodes: 30,
      externalIds: {}, raw: { genres: [], vote_average: 8.0 },
      hydrationLevel: 'detail',
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
  assert.equal(view.kind, 'episode');
  assert.equal(view.title, 'Previous Episode');
  assert.equal(view.subtitle, 'Breaking Point');
  assert.equal(view.summary, 'Previous.');
  assert.deepEqual(view.seriesArtwork, {
    small: 'https://image.tmdb.org/t/p/w780/backdrop.jpg',
    medium: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    large: 'https://image.tmdb.org/t/p/original/backdrop.jpg',
  });
});

test('buildEpisodePreview produces provider-based payload', async () => {
  const { buildEpisodePreview } = await import('./metadata-card.builders.js');

  const preview = buildEpisodePreview({
    title: {
      mediaType: 'tv', tmdbId: 42, language: 'en', name: 'Test Show', originalName: 'Test Show',
      overview: null, tagline: null, releaseDate: null, firstAirDate: null, status: null,
      posterPath: '/poster.jpg', backdropPath: null, runtime: null, episodeRunTime: [],
      numberOfSeasons: null, numberOfEpisodes: null, externalIds: {}, raw: {},
      hydrationLevel: 'detail', fetchedAt: '', expiresAt: '',
    },
    episode: {
      showTmdbId: 42, seasonNumber: 1, episodeNumber: 3, tmdbId: 555,
      name: 'Episode 3', overview: 'Overview.', airDate: '2024-01-15',
      runtime: 47, stillPath: '/still.jpg', voteAverage: 8.1, raw: {},
      fetchedAt: '2026-03-22T00:00:00.000Z', expiresAt: '2026-03-23T00:00:00.000Z',
    },
    itemId: 'uuid-for-test',
  });

  assert.equal(preview.itemId, 'uuid-for-test');
  assert.equal(preview.mediaType, 'episode');
  assert.equal(preview.showTmdbId, 42);
  assert.equal(preview.seasonNumber, 1);
  assert.equal(preview.episodeNumber, 3);
  assert.equal(preview.airDate, '2024-01-15');
  assert.equal(preview.runtimeMinutes, 47);
  assert.equal(preview.rating, 8.1);
  assert.equal(preview.images.still.medium, 'https://image.tmdb.org/t/p/h632/still.jpg');
});

test('buildMetadataCardView omits seriesArtwork for title cards', async () => {
  const { buildMetadataCardView } = await import('./metadata-card.builders.js');

  const view = buildMetadataCardView({
    identity: { mediaKey: 'movie:tmdb:222', mediaType: 'movie', tmdbId: 222, showTmdbId: null, seasonNumber: null, episodeNumber: null },
    title: {
      mediaType: 'movie', tmdbId: 222, language: 'en', name: 'A Movie', originalName: 'A Movie',
      overview: null, tagline: null, releaseDate: null, firstAirDate: null, status: null,
      posterPath: '/poster.jpg', backdropPath: '/backdrop.jpg',
      runtime: null, episodeRunTime: [], numberOfSeasons: null, numberOfEpisodes: null,
      externalIds: {}, raw: {},
      hydrationLevel: 'detail', fetchedAt: '', expiresAt: '',
    },
  });

  assert.equal(view.seriesArtwork, null);
});

test('unrated titles serialize a null rating instead of a 0.0 TMDB vote_average', async () => {
  const { buildMetadataCardView, buildEpisodePreview } = await import('./metadata-card.builders.js');

  const zeroVoteTitle = {
    mediaType: 'movie' as const, tmdbId: 222, language: 'en', name: 'Unrated', originalName: 'Unrated',
    overview: null, tagline: null, releaseDate: null, firstAirDate: null, status: null,
    posterPath: '/poster.jpg', backdropPath: null, runtime: null, episodeRunTime: [],
    numberOfSeasons: null, numberOfEpisodes: null, externalIds: {}, raw: { vote_average: 0 },
    hydrationLevel: 'detail' as const, fetchedAt: '', expiresAt: '',
  };

  const titleView = buildMetadataCardView({
    identity: { mediaKey: 'movie:tmdb:222', mediaType: 'movie', tmdbId: 222, showTmdbId: null, seasonNumber: null, episodeNumber: null },
    title: zeroVoteTitle,
  });
  assert.equal(titleView.rating, null);

  const episodeView = buildMetadataCardView({
    identity: { mediaKey: 'episode:tmdb:42:1:2', mediaType: 'episode', tmdbId: null, showTmdbId: 42, seasonNumber: 1, episodeNumber: 2 },
    title: {
      mediaType: 'tv', tmdbId: 42, language: 'en', name: 'Show', originalName: 'Show',
      overview: null, tagline: null, releaseDate: null, firstAirDate: null, status: null,
      posterPath: '/poster.jpg', backdropPath: null, runtime: null, episodeRunTime: [],
      numberOfSeasons: null, numberOfEpisodes: null, externalIds: {}, raw: {},
      hydrationLevel: 'detail' as const, fetchedAt: '', expiresAt: '',
    },
    currentEpisode: {
      showTmdbId: 42, seasonNumber: 1, episodeNumber: 2, tmdbId: 554,
      name: 'Prev', overview: null, airDate: null, runtime: 45, stillPath: null,
      voteAverage: 0, raw: {}, fetchedAt: '', expiresAt: '',
    },
  });
  assert.equal(episodeView.rating, null);

  const preview = buildEpisodePreview({
    title: zeroVoteTitle,
    episode: {
      showTmdbId: 222, seasonNumber: 1, episodeNumber: 1, tmdbId: 555,
      name: 'Ep', overview: null, airDate: null, runtime: 45, stillPath: null,
      voteAverage: 0, raw: {}, fetchedAt: '', expiresAt: '',
    },
    itemId: 'uuid-for-test',
  });
  assert.equal(preview.rating, null);
});
