import test from 'node:test';
import assert from 'node:assert/strict';
import type { MediaIdentity } from '../identity/media-key.js';
import type { TmdbTitleRecord, TmdbEpisodeRecord } from './providers/tmdb.types.js';

test('buildImageUrl returns null for null path', async () => {
  const { buildImageUrl } = await import('./metadata-builder.shared.js');
  assert.equal(buildImageUrl(null, 'w500'), null);
});

test('buildImageUrl constructs full TMDB URL', async () => {
  const { buildImageUrl } = await import('./metadata-builder.shared.js');
  assert.equal(buildImageUrl('/poster.jpg', 'w500'), 'https://image.tmdb.org/t/p/w500/poster.jpg');
});

test('buildDetailBaseItemDto for show extracts provider-based detail fields', async () => {
  const { buildDetailBaseItemDto } = await import('./metadata-detail.builders.js');

  const identity: MediaIdentity = {
    mediaKey: 'show:tmdb:42',
    mediaType: 'show',
    tmdbId: 42,
    showTmdbId: 42,
    seasonNumber: null,
    episodeNumber: null,
  };

  const title: TmdbTitleRecord = {
    mediaType: 'tv',
    tmdbId: 42,
    language: 'en',
    name: 'Breaking Point',
    originalName: 'Breaking Point',
    overview: 'A thrilling drama.',
    releaseDate: null,
    firstAirDate: '2024-01-01',
    status: 'Returning Series',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: null,
    episodeRunTime: [45, 42],
    numberOfSeasons: 3,
    numberOfEpisodes: 30,
    externalIds: { imdb_id: 'tt1234567', tvdb_id: 98765 },
    raw: {
      genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }],
      vote_average: 8.4,
      images: { logos: [{ file_path: '/logo.png', iso_639_1: 'en' }] },
      content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
    },
    hydrationLevel: 'detail',
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const dto = buildDetailBaseItemDto({ identity, itemId: 'uuid-for-test', title });

  assert.equal(dto.Id, 'uuid-for-test');
  assert.equal(dto.Type, 'Series');
  assert.equal(dto.Name, 'Breaking Point');
  assert.equal(dto.Overview, 'A thrilling drama.');
  assert.equal(dto.ProductionYear, 2024);
  assert.equal(dto.PremiereDate, '2024-01-01');
  assert.equal(dto.CommunityRating, 8.4);
  assert.equal(dto.OfficialRating, 'TV-MA');
  assert.equal(dto.Certification, 'TV-MA');
  assert.deepEqual(dto.Genres, ['Drama', 'Crime']);
  assert.equal(dto.Status, 'Returning Series');
  assert.equal(dto.ProviderIds.Tmdb, '42');
  assert.equal(dto.ProviderIds.Imdb, 'tt1234567');
  assert.equal(dto.ProviderIds.Tvdb, '98765');
  assert.equal(dto.ImageTags.Primary?.medium, 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.equal(dto.ImageTags.Backdrop[0]?.medium, 'https://image.tmdb.org/t/p/w780/backdrop.jpg');
  assert.equal(dto.ImageTags.Logo?.medium, 'https://image.tmdb.org/t/p/w300/logo.png');
  assert.equal(dto.SeriesId, null);
  assert.equal(dto.SeriesName, null);
  assert.equal(dto.SeasonId, null);
  assert.equal(dto.SeasonName, null);
  assert.equal(dto.ParentIndexNumber, null);
  assert.equal(dto.IndexNumber, null);
  assert.equal(dto.EpisodeTitle, null);
  assert.equal(dto.AirDate, null);
});

test('buildDetailBaseItemDto with null title returns minimal item', async () => {
  const { buildDetailBaseItemDto } = await import('./metadata-detail.builders.js');

  const identity: MediaIdentity = {
    mediaKey: 'movie:tmdb:99',
    mediaType: 'movie',
    tmdbId: 99,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
  };

  const dto = buildDetailBaseItemDto({ identity, itemId: 'uuid-for-test', title: null });

  assert.equal(dto.Id, 'uuid-for-test');
  assert.equal(dto.Type, 'Movie');
  assert.equal(dto.Name, 'Untitled');
  assert.equal(dto.ProviderIds.Tmdb, null);
  assert.equal(dto.Genres.length, 0);
});

test('buildEpisodeBaseItemDto populates episode fields', async () => {
  const { buildEpisodeBaseItemDto } = await import('./metadata-detail.builders.js');

  const title: TmdbTitleRecord = {
    mediaType: 'tv',
    tmdbId: 42,
    language: 'en',
    name: 'Breaking Point',
    originalName: 'Breaking Point',
    overview: null,
    releaseDate: null,
    firstAirDate: null,
    status: 'Returning Series',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: null,
    episodeRunTime: [45],
    numberOfSeasons: 3,
    numberOfEpisodes: 30,
    externalIds: { imdb_id: 'tt1234567' },
    hydrationLevel: 'detail',
    raw: {
      genres: [{ id: 18, name: 'Drama' }],
      content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
    },
    fetchedAt: '',
    expiresAt: '',
  };

  const episode: TmdbEpisodeRecord = {
    showTmdbId: 42,
    seasonNumber: 1,
    episodeNumber: 3,
    tmdbId: 555,
    name: 'Episode 3',
    overview: 'The third episode.',
    airDate: '2024-01-15',
    runtime: 45,
    stillPath: '/still.jpg',
    voteAverage: 7.5,
    raw: {},
    fetchedAt: '',
    expiresAt: '',
  };

  const dto = buildEpisodeBaseItemDto(title, episode, 'uuid-episode-42-1-3', 'uuid-show-42');

  assert.equal(dto.Id, 'uuid-episode-42-1-3');
  assert.equal(dto.Type, 'Episode');
  assert.equal(dto.Name, 'Episode 3');
  assert.equal(dto.Overview, 'The third episode.');
  assert.equal(dto.SeriesName, 'Breaking Point');
  assert.equal(dto.ParentIndexNumber, 1);
  assert.equal(dto.IndexNumber, 3);
  assert.equal(dto.EpisodeTitle, 'Episode 3');
  assert.equal(dto.AirDate, '2024-01-15');
  assert.equal(dto.ProductionYear, 2024);
  assert.equal(dto.CommunityRating, 7.5);
  assert.equal(dto.ProviderIds.Tmdb, '42');
  assert.equal(dto.ProviderIds.Imdb, 'tt1234567');
  assert.equal(dto.ImageTags.Primary?.medium, 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.equal(dto.ImageTags.Backdrop[0]?.medium, 'https://image.tmdb.org/t/p/w780/still.jpg');
  assert.equal(dto.ImageTags.Thumb?.medium, 'https://image.tmdb.org/t/p/w300/still.jpg');
  assert.equal(dto.Genres.length, 1);
  assert.equal(dto.PremiereDate, '2024-01-15');
});

test('buildSeasonBaseItemDto populates season fields', async () => {
  const { buildSeasonBaseItemDto } = await import('./metadata-detail.builders.js');

  const title: TmdbTitleRecord = {
    mediaType: 'tv',
    tmdbId: 42,
    language: 'en',
    name: 'Breaking Point',
    originalName: 'Breaking Point',
    overview: 'A thrilling drama.',
    releaseDate: null,
    firstAirDate: '2024-01-01',
    status: 'Returning Series',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: null,
    episodeRunTime: [45],
    numberOfSeasons: 3,
    numberOfEpisodes: 30,
    externalIds: { imdb_id: 'tt1234567' },
    hydrationLevel: 'detail',
    raw: {
      seasons: [
        { season_number: 1, name: 'Season 1', episode_count: 10, air_date: '2024-01-01', overview: 'S1 overview', poster_path: '/season1.jpg' },
        { season_number: 2, name: 'Season 2', episode_count: 8, air_date: '2025-01-01', overview: 'The second season.', poster_path: '/season2.jpg' },
      ],
      genres: [{ id: 18, name: 'Drama' }],
      content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
    },
    fetchedAt: '',
    expiresAt: '',
  };

  const dto = buildSeasonBaseItemDto(title, 2, 'uuid-season-42-2', 'uuid-series-42');

  assert.equal(dto.Id, 'uuid-season-42-2');
  assert.equal(dto.Type, 'Season');
  assert.equal(dto.Name, 'Season 2');
  assert.equal(dto.Overview, 'The second season.');
  assert.equal(dto.SeriesName, 'Breaking Point');
  assert.equal(dto.SeasonId, 'uuid-season-42-2');
  assert.equal(dto.SeasonName, 'Season 2');
  assert.equal(dto.ParentIndexNumber, null);
  assert.equal(dto.IndexNumber, 2);
  assert.equal(dto.EpisodeTitle, null);
  assert.equal(dto.AirDate, null);
  assert.equal(dto.PremiereDate, '2025-01-01');
  assert.equal(dto.ProductionYear, 2025);
  assert.equal(dto.ImageTags.Primary?.medium, 'https://image.tmdb.org/t/p/w500/season2.jpg');
  assert.equal(dto.ImageTags.Backdrop[0]?.medium, 'https://image.tmdb.org/t/p/w780/backdrop.jpg');
  assert.equal(dto.ProviderIds.Tmdb, '42');
});

test('buildSeasonBaseItemDto uses fallback when raw season missing', async () => {
  const { buildSeasonBaseItemDto } = await import('./metadata-detail.builders.js');

  const title: TmdbTitleRecord = {
    mediaType: 'tv',
    tmdbId: 42,
    language: 'en',
    name: 'Breaking Point',
    originalName: 'Breaking Point',
    overview: null,
    releaseDate: null,
    firstAirDate: null,
    status: null,
    posterPath: '/poster.jpg',
    backdropPath: null,
    runtime: null,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    hydrationLevel: 'detail',
    raw: {},
    fetchedAt: '',
    expiresAt: '',
  };

  const dto = buildSeasonBaseItemDto(title, 1, 'uuid-season-42-1', 'uuid-series-42');

  assert.equal(dto.Id, 'uuid-season-42-1');
  assert.equal(dto.Type, 'Season');
  assert.equal(dto.Name, 'Season 1');
  assert.equal(dto.SeasonName, 'Season 1');
  assert.equal(dto.ParentIndexNumber, null);
  assert.equal(dto.IndexNumber, 1);
  assert.equal(dto.Overview, null);
  assert.equal(dto.PremiereDate, null);
  assert.equal(dto.ProductionYear, null);
  assert.equal(dto.ImageTags.Primary?.medium, 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.equal(dto.ImageTags.Primary?.small, 'https://image.tmdb.org/t/p/w342/poster.jpg');
  assert.equal(dto.ImageTags.Primary?.large, 'https://image.tmdb.org/t/p/w780/poster.jpg');
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
    language: 'en',
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
    hydrationLevel: 'detail',
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
