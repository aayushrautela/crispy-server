import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { ProviderTitleRecord } from './metadata-card.types.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';

seedTestEnv();

test('buildImageUrl returns null for null path', async () => {
  const { buildImageUrl } = await import('./metadata-builder.shared.js');
  assert.equal(buildImageUrl(null, 'w500'), null);
});

test('buildImageUrl constructs full TMDB URL', async () => {
  const { buildImageUrl } = await import('./metadata-builder.shared.js');
  assert.equal(buildImageUrl('/poster.jpg', 'w500'), 'https://image.tmdb.org/t/p/w500/poster.jpg');
});

test('buildMetadataView for show extracts provider-based detail fields', async () => {
  const { buildMetadataView } = await import('./metadata-detail.builders.js');

  const view = buildMetadataView({
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

  assert.equal(view.mediaType, 'show');
  assert.equal(view.provider, 'tmdb');
  assert.equal(view.providerId, '42');
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

test('buildSeasonViewFromTitleRaw builds provider-based seasons', async () => {
  const { buildSeasonViewFromTitleRaw } = await import('./metadata-detail.builders.js');

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
    new Map([[0, 'uuid-season-42-0'], [1, 'uuid-season-42-1']]),
  );

  assert.equal(seasons.length, 2);
  assert.equal(seasons[0]?.providerId, '42:s0');
  assert.equal(seasons[1]?.providerId, '42:s1');
  assert.equal(seasons[1]?.images.posterUrl, 'https://image.tmdb.org/t/p/w500/season1.jpg');
});

test('buildSeasonViewFromRecord produces clean payload', async () => {
  const { buildSeasonViewFromRecord } = await import('./metadata-detail.builders.js');

  const view = buildSeasonViewFromRecord(42, {
    showTmdbId: 42, seasonNumber: 2, name: 'Season 2',
    overview: 'The second season.', airDate: '2025-01-01',
    posterPath: '/season2.jpg', episodeCount: 8, raw: {},
    fetchedAt: '2026-03-22T00:00:00.000Z', expiresAt: '2026-03-23T00:00:00.000Z',
  }, 'uuid-season-42-2', 'uuid-show-42');

  assert.equal(view.providerId, '42:s2');
  assert.equal(view.parentProviderId, '42');
  assert.equal(view.title, 'Season 2');
  assert.equal(view.episodeCount, 8);
  assert.equal(view.images.posterUrl, 'https://image.tmdb.org/t/p/w500/season2.jpg');
});

test('buildEpisodeView includes provider-based show context', async () => {
  const { buildEpisodeView } = await import('./metadata-detail.builders.js');

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

  assert.equal(view.providerId, '42:s1:e3');
  assert.equal(view.parentProviderId, '42');
  assert.equal(view.showTitle, 'Breaking Point');
  assert.equal(view.showExternalIds.imdb, 'tt1234567');
});

test('extractReleaseYear returns year from date string', async () => {
  const { extractReleaseYear } = await import('./metadata-builder.shared.js');
  assert.equal(extractReleaseYear('2024-01-15'), 2024);
  assert.equal(extractReleaseYear(null), null);
  assert.equal(extractReleaseYear(''), null);
});

test('rich detail extractors map videos, people, reviews, production, and collection', async () => {
  const {
    extractVideos,
    extractCast,
    extractCrewByJob,
    extractCreators,
    extractReviews,
    extractProduction,
    extractCollection,
    extractCollectionParts,
    extractSimilarTitles,
  } = await import('./metadata-builder.shared.js');

  const title: TmdbTitleRecord = {
    mediaType: 'tv',
    tmdbId: 42,
    name: 'Breaking Point',
    originalName: 'Breaking Point',
    overview: null,
    releaseDate: null,
    firstAirDate: '2024-01-01',
    status: 'Returning Series',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: null,
    episodeRunTime: [45],
    numberOfSeasons: 3,
    numberOfEpisodes: 30,
    externalIds: {},
    raw: {
      videos: {
        results: [{ id: 'vid1', key: 'abc123', name: 'Official Trailer', site: 'YouTube', type: 'Trailer', official: true, published_at: '2024-01-01T00:00:00.000Z' }],
      },
      credits: {
        cast: [{ id: 10, name: 'Lead Actor', character: 'Hero', known_for_department: 'Acting', profile_path: '/actor.jpg' }],
        crew: [{ id: 11, name: 'Director Name', job: 'Director', department: 'Directing', profile_path: '/director.jpg' }],
      },
      created_by: [{ id: 12, name: 'Creator Name', known_for_department: 'Writing', profile_path: '/creator.jpg' }],
      reviews: {
        results: [{ id: 'review-1', author: 'Critic', content: 'Excellent.', url: 'https://example.com/review', created_at: '2024-01-02T00:00:00.000Z', updated_at: '2024-01-03T00:00:00.000Z', author_details: { username: 'critic1', rating: 8, avatar_path: '/https://cdn.example/avatar.png' } }],
      },
      original_language: 'en',
      origin_country: ['US'],
      spoken_languages: [{ english_name: 'English' }],
      production_countries: [{ name: 'United States of America' }],
      production_companies: [{ id: 20, name: 'Studio One', logo_path: '/studio.jpg', origin_country: 'US' }],
      networks: [{ id: 21, name: 'Network One', logo_path: '/network.jpg', origin_country: 'US' }],
      belongs_to_collection: { id: 99, name: 'Saga Collection', poster_path: '/collection-poster.jpg', backdrop_path: '/collection-backdrop.jpg' },
      parts: [
        { id: 101, title: 'Saga Collection: Part I', overview: 'The beginning.', release_date: '2020-01-01', poster_path: '/part1-poster.jpg', backdrop_path: '/part1-backdrop.jpg' },
        { id: 102, title: 'Saga Collection: Part II', overview: 'The sequel.', release_date: '2021-01-01', poster_path: '/part2-poster.jpg', backdrop_path: '/part2-backdrop.jpg' },
      ],
      recommendations: {
        results: [
          { id: 77, name: 'Breaking Point: Aftermath', original_name: 'Breaking Point: Aftermath', overview: 'Another chapter.', first_air_date: '2025-01-01', poster_path: '/similar-poster.jpg', backdrop_path: '/similar-backdrop.jpg' },
        ],
      },
    },
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  assert.equal(extractVideos(title)[0]?.url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(extractCast(title)[0]?.name, 'Lead Actor');
  assert.equal(extractCrewByJob(title, 'Director')[0]?.name, 'Director Name');
  assert.equal(extractCreators(title)[0]?.name, 'Creator Name');
  assert.equal(extractReviews(title)[0]?.avatarUrl, 'https://cdn.example/avatar.png');
  assert.equal(extractProduction(title).originalLanguage, 'en');
  assert.equal(extractProduction(title).companies[0]?.name, 'Studio One');
  assert.equal(extractCollection(title)?.name, 'Saga Collection');
  assert.equal(extractCollectionParts(title.raw)[0]?.tmdbId, 101);
  assert.equal(extractCollectionParts(title.raw)[1]?.name, 'Saga Collection: Part II');
  assert.equal(extractSimilarTitles(title)[0]?.tmdbId, 77);
  assert.equal(extractSimilarTitles(title)[0]?.name, 'Breaking Point: Aftermath');
});

test('TVDB title normalization localizes text and does not use generic image as backdrop', async () => {
  const { normalizeTvdbTitle } = await import('./provider-metadata.service.js');

  const title = normalizeTvdbTitle({
    data: {
      id: '412436',
      name: 'Cars on the Road',
      overview: 'Lightning and Mater hit the road.',
      firstAired: '2022-09-08',
      status: { name: 'Ended' },
      image: '/banners/fallback-poster.jpg',
      score: 23345,
      contentRating: 'TV-G',
      genres: [{ name: 'Animation' }],
      episodeCount: 9,
      seasons: [{ number: 1 }],
      translations: {
        nameTranslations: [
          { language: 'spa', name: 'Coches en la carretera' },
          { language: 'eng', name: 'Cars on the Road' },
        ],
        overviewTranslations: [
          { language: 'spa', overview: 'Rayo y Mate salen de viaje.' },
          { language: 'eng', overview: 'Lightning and Mater hit the road.' },
        ],
      },
      artworks: [
        { type: 'clearlogo', language: 'spa', image: '/banners/logo.png' },
        { type: 'poster', language: 'spa', image: '/banners/poster.jpg' },
      ],
      remoteIds: [{ sourceName: 'IMDB', id: 'tt1234567' }],
    },
  }, '412436', 'es-ES');

  assert.equal(title.title, 'Coches en la carretera');
  assert.equal(title.summary, 'Rayo y Mate salen de viaje.');
  assert.equal(title.posterUrl, 'https://artworks.thetvdb.com/banners/poster.jpg');
  assert.equal(title.backdropUrl, null);
  assert.equal(title.logoUrl, 'https://artworks.thetvdb.com/banners/logo.png');
  assert.equal(title.rating, null);
  assert.equal(title.certification, 'TV-G');
});

test('TVDB episode normalization localizes text and expands relative stills', async () => {
  const { normalizeTvdbEpisode } = await import('./provider-metadata.service.js');

  const episode = normalizeTvdbEpisode({
    seasonNumber: 1,
    number: 2,
    name: 'Lights Out',
    overview: 'The road trip continues.',
    aired: '2022-09-08',
    runtime: 22,
    score: 9812,
    image: '/banners/v4/episode/8835563/screencap/test.jpg',
    translations: {
      nameTranslations: [{ language: 'spa', name: 'Luces fuera' }],
      overviewTranslations: [{ language: 'spa', overview: 'El viaje por carretera continua.' }],
    },
  }, '412436', 'es-ES');

  assert.ok(episode);
  assert.equal(episode?.title, 'Luces fuera');
  assert.equal(episode?.summary, 'El viaje por carretera continua.');
  assert.equal(episode?.stillUrl, 'https://artworks.thetvdb.com/banners/v4/episode/8835563/screencap/test.jpg');
  assert.equal(episode?.rating, null);
});

test('Kitsu title normalization converts average rating to 10-point scale', async () => {
  const { normalizeKitsuTitle } = await import('./provider-metadata.service.js');

  const title = normalizeKitsuTitle({
    data: {
      id: '12',
      attributes: {
        canonicalTitle: 'One Piece',
        averageRating: '83.96',
        ageRatingGuide: 'Teens 13 or older',
        posterImage: { original: 'https://cdn.example/poster.jpg' },
        coverImage: { original: 'https://cdn.example/cover.jpg' },
      },
    },
    included: [],
  }, '12');

  assert.equal(title.rating, 8.4);
  assert.equal(title.posterUrl, 'https://cdn.example/poster.jpg');
  assert.equal(title.backdropUrl, 'https://cdn.example/cover.jpg');
});

test('TVDB crew extracts direct roles and reviews stay empty when unsupported', async () => {
  const { buildProviderCrew, buildProviderReviews } = await import('./provider-metadata.service.js');

  const tvdbTitle: ProviderTitleRecord = {
    mediaType: 'show',
    provider: 'tvdb',
    providerId: '412436',
    title: 'Cars on the Road',
    originalTitle: 'Cars on the Road',
    summary: null,
    overview: null,
    releaseDate: null,
    status: null,
    posterUrl: null,
    backdropUrl: null,
    logoUrl: null,
    runtimeMinutes: null,
    rating: null,
    certification: null,
    genres: [],
    externalIds: { tmdb: null, imdb: null, tvdb: 412436, kitsu: null },
    seasonCount: null,
    episodeCount: null,
    raw: {
      data: {
        characters: [
          { peopleId: '1', personName: 'Actor Name', name: 'Character Name', peopleType: 'Actor' },
          { peopleId: '2', personName: 'Director Name', name: 'Director', peopleType: 'Director' },
        ],
      },
    },
  };

  assert.equal(buildProviderCrew(tvdbTitle, undefined, ['director'])[0]?.name, 'Director Name');
  assert.deepEqual(buildProviderReviews(tvdbTitle, undefined), []);
});
