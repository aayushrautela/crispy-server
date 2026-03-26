import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

async function loadModule() {
  return import('./metadata-normalizers.js');
}

test('buildImageUrl returns null for null path', async () => {
  const { buildImageUrl } = await loadModule();
  assert.equal(buildImageUrl(null, 'w500'), null);
});

test('buildImageUrl constructs full TMDB URL', async () => {
  const { buildImageUrl } = await loadModule();
  assert.equal(buildImageUrl('/poster.jpg', 'w500'), 'https://image.tmdb.org/t/p/w500/poster.jpg');
});

test('buildMetadataView for show uses canonical ids and extracts fields', async () => {
  const { buildMetadataView } = await loadModule();

  const view = buildMetadataView({
    id: 'uuid-show-42',
    identity: { mediaKey: 'show:tmdb:42', mediaType: 'show', tmdbId: 42, showTmdbId: 42, seasonNumber: null, episodeNumber: null },
    title: {
      mediaType: 'tv', tmdbId: 42, name: 'Breaking Point', originalName: 'Breaking Point',
      overview: 'A thrilling drama.', releaseDate: null, firstAirDate: '2024-01-01',
      status: 'Returning Series', posterPath: '/poster.jpg', backdropPath: '/backdrop.jpg',
      runtime: null, episodeRunTime: [45, 42], numberOfSeasons: 3, numberOfEpisodes: 30,
      externalIds: { imdb_id: 'tt1234567', tvdb_id: 98765 },
      raw: {
        genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }],
        vote_average: 8.4,
        images: { logos: [{ file_path: '/logo.png', iso_639_1: 'en' }] },
        content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
      },
      fetchedAt: '2026-03-22T00:00:00.000Z', expiresAt: '2026-03-23T00:00:00.000Z',
    },
  });

  assert.equal(view.id, 'uuid-show-42');
  assert.equal(view.mediaType, 'show');
  assert.equal(view.kind, 'title');
  assert.equal(view.title, 'Breaking Point');
  assert.equal(view.overview, 'A thrilling drama.');
  assert.equal(view.artwork.posterUrl, 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.equal(view.artwork.backdropUrl, 'https://image.tmdb.org/t/p/w780/backdrop.jpg');
  assert.equal(view.images.logoUrl, 'https://image.tmdb.org/t/p/w500/logo.png');
  assert.equal(view.rating, 8.4);
  assert.deepEqual(view.genres, ['Drama', 'Crime']);
  assert.equal(view.certification, 'TV-MA');
  assert.equal(view.seasonCount, 3);
  assert.equal(view.episodeCount, 30);
  assert.equal(view.externalIds.imdb, 'tt1234567');
  assert.equal(view.externalIds.tvdb, 98765);
});

test('buildMetadataCardView for episode uses show title and episode subtitle', async () => {
  const { buildMetadataCardView } = await loadModule();

  const view = buildMetadataCardView({
    id: 'uuid-episode-42-1-2',
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

  assert.equal(view.id, 'uuid-episode-42-1-2');
  assert.equal(view.mediaType, 'episode');
  assert.equal(view.kind, 'episode');
  assert.equal(view.title, 'Breaking Point');
  assert.equal(view.subtitle, 'Previous Episode');
  assert.equal(view.summary, 'Previous.');
});

test('buildEpisodePreview produces canonical id payload', async () => {
  const { buildEpisodePreview } = await loadModule();

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
    'uuid-episode-42-1-3',
  );

  assert.equal(preview.id, 'uuid-episode-42-1-3');
  assert.equal(preview.mediaType, 'episode');
  assert.equal(preview.showTmdbId, 42);
  assert.equal(preview.seasonNumber, 1);
  assert.equal(preview.episodeNumber, 3);
  assert.equal(preview.airDate, '2024-01-15');
  assert.equal(preview.runtimeMinutes, 47);
  assert.equal(preview.rating, 8.1);
  assert.equal(preview.images.stillUrl, 'https://image.tmdb.org/t/p/w500/still.jpg');
});

test('buildSeasonViewFromTitleRaw uses provided canonical ids', async () => {
  const { buildSeasonViewFromTitleRaw } = await loadModule();

  const seasons = buildSeasonViewFromTitleRaw(
    {
      mediaType: 'tv', tmdbId: 42, name: 'Test Show', originalName: 'Test Show',
      overview: null, releaseDate: null, firstAirDate: null, status: null,
      posterPath: null, backdropPath: null, runtime: null, episodeRunTime: [],
      numberOfSeasons: null, numberOfEpisodes: null, externalIds: {},
      raw: {
        seasons: [
          { season_number: 0, name: 'Specials', poster_path: '/season0.jpg' },
          { season_number: 1, name: 'Season 1', episode_count: 10, air_date: '2024-01-01', overview: 'S1 overview', poster_path: '/season1.jpg' },
        ],
      },
      fetchedAt: '', expiresAt: '',
    },
    'uuid-show-42',
    new Map([[0, 'uuid-season-42-0'], [1, 'uuid-season-42-1']]),
  );

  assert.equal(seasons.length, 2);
  assert.equal(seasons[0]?.id, 'uuid-season-42-0');
  assert.equal(seasons[0]?.showId, 'uuid-show-42');
  assert.equal(seasons[1]?.id, 'uuid-season-42-1');
  assert.equal(seasons[1]?.images.posterUrl, 'https://image.tmdb.org/t/p/w500/season1.jpg');
});

test('buildSeasonViewFromRecord produces clean payload', async () => {
  const { buildSeasonViewFromRecord } = await loadModule();

  const view = buildSeasonViewFromRecord(42, {
    showTmdbId: 42, seasonNumber: 2, name: 'Season 2',
    overview: 'The second season.', airDate: '2025-01-01',
    posterPath: '/season2.jpg', episodeCount: 8, raw: {},
    fetchedAt: '2026-03-22T00:00:00.000Z', expiresAt: '2026-03-23T00:00:00.000Z',
  }, 'uuid-season-42-2', 'uuid-show-42');

  assert.equal(view.id, 'uuid-season-42-2');
  assert.equal(view.showId, 'uuid-show-42');
  assert.equal(view.title, 'Season 2');
  assert.equal(view.episodeCount, 8);
  assert.equal(view.images.posterUrl, 'https://image.tmdb.org/t/p/w500/season2.jpg');
});

test('buildEpisodeView includes canonical show context', async () => {
  const { buildEpisodeView } = await loadModule();

  const view = buildEpisodeView(
    {
      mediaType: 'tv', tmdbId: 42, name: 'Breaking Point', originalName: 'Breaking Point',
      overview: null, releaseDate: null, firstAirDate: null, status: null,
      posterPath: '/poster.jpg', backdropPath: null, runtime: null, episodeRunTime: [],
      numberOfSeasons: null, numberOfEpisodes: null, externalIds: { imdb_id: 'tt1234567' },
      raw: {}, fetchedAt: '', expiresAt: '',
    },
    {
      showTmdbId: 42, seasonNumber: 1, episodeNumber: 3, tmdbId: 555,
      name: 'Episode 3', overview: null, airDate: null, runtime: null,
      stillPath: null, voteAverage: null, raw: {}, fetchedAt: '', expiresAt: '',
    },
    'uuid-episode-42-1-3', 'uuid-show-42',
  );

  assert.equal(view.id, 'uuid-episode-42-1-3');
  assert.equal(view.showId, 'uuid-show-42');
  assert.equal(view.showTitle, 'Breaking Point');
  assert.equal(view.showExternalIds.imdb, 'tt1234567');
});

test('extractReleaseYear returns year from date string', async () => {
  const { extractReleaseYear } = await loadModule();
  assert.equal(extractReleaseYear('2024-01-15'), 2024);
  assert.equal(extractReleaseYear(null), null);
  assert.equal(extractReleaseYear(''), null);
});
