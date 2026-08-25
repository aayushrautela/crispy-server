import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import type { MetadataReviewView } from './metadata-detail.types.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';

setTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-test-id' });

function buildStoredReview(id: string, content: string): Record<string, unknown> {
  return {
    source: 'tmdb',
    reviewKey: id,
    author: 'Critic',
    authorUsername: `critic-${id}`,
    content,
    lang: 'en',
    url: `https://example.com/reviews/${id}`,
    rating: '8',
    avatarUrl: null,
    createdAt: '2024-01-02T00:00:00.000Z',
  };
}

function buildFallbackReview(id: string, content: string): MetadataReviewView {
  return {
    id,
    provider: 'trakt',
    author: 'Trakt User',
    username: `trakt-${id}`,
    content,
    createdAt: '2024-02-01T00:00:00.000Z',
    updatedAt: '2024-02-01T00:00:00.000Z',
    url: `https://trakt.tv/comments/${id}`,
    rating: 9,
    avatarUrl: null,
  };
}

test('MetadataReviewsService tops up TMDB movie reviews from Trakt when under threshold', async () => {
  const { MetadataReviewsService } = await import('./metadata-reviews.service.js');
  const { MetadataReviewAggregator } = await import('./metadata-review-aggregator.js');

  const tmdbTitle: TmdbTitleRecord = {
    mediaType: 'movie',
    tmdbId: 42,
    language: 'en',
    name: 'Batman Begins',
    originalName: 'Batman Begins',
    overview: 'A bat starts.',
    tagline: null,
    releaseDate: '2005-06-15',
    firstAirDate: null,
    status: 'Released',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: 140,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: { imdb_id: 'tt0372784', tvdb_id: null },
    raw: {
      genres: [],
      videos: { results: [] },
      credits: { cast: [], crew: [] },
      created_by: [],
      reviews: { results: [] },
      production_companies: [],
      networks: [],
      production_countries: [],
      spoken_languages: [],
      similar: { results: [] },
    },
    hydrationLevel: 'detail',
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const traktCalls: Array<{ mediaType: 'movie' | 'show'; accessToken?: string; externalIds: { imdb: string | null; tmdb: number | null; tvdb: number | null } }> = [];
  const service = new MetadataReviewsService(
    new MetadataReviewAggregator(
      {
        loadTitleSource: async () => ({
          identity: inferMediaIdentity({ mediaType: 'movie', tmdbId: 42 }),
          language: null,
          tmdbTitle,
          tmdbNextEpisode: null,
        }),
      } as never,
      { getReviews: async () => [buildStoredReview('tmdb-1', 'TMDB review')] } as never,
      {
        isConfigured: () => true,
        fetchTitleReviews: async (
          mediaType: 'movie' | 'show',
          externalIds: { imdb: string | null; tmdb: number | null; tvdb: number | null },
          _limit: number,
          options?: { accessToken?: string },
        ) => {
          traktCalls.push({ mediaType, externalIds, accessToken: options?.accessToken });
          return [
            buildFallbackReview('trakt-1', 'Trakt review 1'),
            buildFallbackReview('trakt-2', 'Trakt review 2'),
          ];
        },
      } as never,
      {
        getAccessTokenForAccountProfile: async () => ({ accessToken: 'user-trakt-token' }),
      } as never,
    ),
    {} as never,
  );

  const reviews = await service.loadTitleReviews(
    {} as never,
    'user-1',
    'profile-1',
    inferMediaIdentity({ mediaType: 'movie', tmdbId: 42 }),
  );

  assert.equal(reviews.length, 3);
  assert.equal(reviews[0]?.id, 'trakt-1');
  assert.equal(reviews[1]?.id, 'trakt-2');
  assert.equal(reviews[2]?.id, 'tmdb-1');
  assert.deepEqual(traktCalls, [{ mediaType: 'movie', accessToken: 'user-trakt-token', externalIds: { imdb: 'tt0372784', tmdb: 42, tvdb: null } }]);
});

test('MetadataReviewsService tops up TMDB show reviews from Trakt when under threshold', async () => {
  const { MetadataReviewsService } = await import('./metadata-reviews.service.js');
  const { MetadataReviewAggregator } = await import('./metadata-review-aggregator.js');

  const tmdbTitle: TmdbTitleRecord = {
    mediaType: 'tv',
    tmdbId: 555,
    language: 'en',
    name: 'One Piece',
    originalName: 'One Piece',
    overview: 'Pirates.',
    tagline: null,
    releaseDate: null,
    firstAirDate: '1999-10-20',
    status: 'Returning Series',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: null,
    episodeRunTime: [24],
    numberOfSeasons: 20,
    numberOfEpisodes: 1000,
    externalIds: { imdb_id: null, tvdb_id: null },
    raw: {
      genres: [],
      videos: { results: [] },
      credits: { cast: [], crew: [] },
      created_by: [],
      reviews: { results: [] },
      production_companies: [],
      networks: [],
      production_countries: [],
      spoken_languages: [],
      similar: { results: [] },
    },
    hydrationLevel: 'detail',
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  let traktMediaType: 'movie' | 'show' | null = null;
  const service = new MetadataReviewsService(
    new MetadataReviewAggregator(
      {
        loadTitleSource: async () => ({
          identity: inferMediaIdentity({ mediaType: 'show', tmdbId: 555 }),
          language: null,
          tmdbTitle,
          tmdbNextEpisode: null,
        }),
      } as never,
      { getReviews: async () => [buildStoredReview('tmdb-1', 'TMDB review')] } as never,
      {
        isConfigured: () => true,
        fetchTitleReviews: async (mediaType: 'movie' | 'show', externalIds: { imdb: string | null; tmdb: number | null; tvdb: number | null }) => {
          traktMediaType = mediaType;
          assert.deepEqual(externalIds, { imdb: null, tmdb: 555, tvdb: null });
          return [
            buildFallbackReview('trakt-a', 'Trakt show review 1'),
            buildFallbackReview('trakt-b', 'Trakt show review 2'),
          ];
        },
      } as never,
      {
        getAccessTokenForAccountProfile: async () => ({ accessToken: 'show-token' }),
      } as never,
    ),
    {} as never,
  );

  const reviews = await service.loadTitleReviews(
    {} as never,
    'user-1',
    'profile-1',
    inferMediaIdentity({ mediaType: 'show', tmdbId: 555 }),
  );

  assert.equal(reviews.length, 3);
  assert.equal(reviews[0]?.id, 'trakt-a');
  assert.equal(traktMediaType, 'show');
});

test('MetadataReviewsService skips Trakt fallback when enough primary reviews already exist', async () => {
  const { MetadataReviewsService } = await import('./metadata-reviews.service.js');
  const { MetadataReviewAggregator } = await import('./metadata-review-aggregator.js');

  const tmdbTitle: TmdbTitleRecord = {
    mediaType: 'tv',
    tmdbId: 1396,
    language: 'en',
    name: 'Breaking Bad',
    originalName: 'Breaking Bad',
    overview: 'Chemistry.',
    tagline: null,
    releaseDate: null,
    firstAirDate: '2008-01-20',
    status: 'Ended',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: null,
    episodeRunTime: [45],
    numberOfSeasons: 5,
    numberOfEpisodes: 62,
    externalIds: { imdb_id: 'tt0903747', tvdb_id: 81189 },
    raw: {
      genres: [],
      videos: { results: [] },
      credits: { cast: [], crew: [] },
      created_by: [],
      reviews: { results: [] },
      production_companies: [],
      networks: [],
      production_countries: [],
      spoken_languages: [],
      similar: { results: [] },
    },
    hydrationLevel: 'detail',
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  let traktCalled = false;
  const service = new MetadataReviewsService(
    new MetadataReviewAggregator(
      {
        loadTitleSource: async () => ({
          identity: inferMediaIdentity({ mediaType: 'show', tmdbId: 1396 }),
          language: null,
          tmdbTitle,
          tmdbNextEpisode: null,
        }),
      } as never,
      {
        getReviews: async () => [
          buildStoredReview('provider-1', 'Provider review 1'),
          buildStoredReview('provider-2', 'Provider review 2'),
          buildStoredReview('provider-3', 'Provider review 3'),
          buildStoredReview('provider-4', 'Provider review 4'),
          buildStoredReview('provider-5', 'Provider review 5'),
        ],
      } as never,
      {
        isConfigured: () => true,
        fetchTitleReviews: async () => {
          traktCalled = true;
          return [];
        },
      } as never,
      {} as never,
    ),
    {} as never,
  );

  const reviews = await service.loadTitleReviews(
    {} as never,
    'user-1',
    'profile-1',
    inferMediaIdentity({ mediaType: 'show', tmdbId: 1396 }),
  );

  assert.equal(reviews.length, 5);
  assert.equal(traktCalled, false);
});

test('MetadataReviewsService falls back to app-key Trakt when profile token is unavailable', async () => {
  const { MetadataReviewsService } = await import('./metadata-reviews.service.js');
  const { MetadataReviewAggregator } = await import('./metadata-review-aggregator.js');

  const tmdbTitle: TmdbTitleRecord = {
    mediaType: 'movie',
    tmdbId: 7,
    language: 'en',
    name: 'Se7en',
    originalName: 'Se7en',
    overview: 'Detectives.',
    tagline: null,
    releaseDate: '1995-09-22',
    firstAirDate: null,
    status: 'Released',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: 127,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: { imdb_id: 'tt0114369', tvdb_id: null },
    raw: {
      genres: [],
      videos: { results: [] },
      credits: { cast: [], crew: [] },
      created_by: [],
      reviews: { results: [] },
      production_companies: [],
      networks: [],
      production_countries: [],
      spoken_languages: [],
      similar: { results: [] },
    },
    hydrationLevel: 'detail',
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  let usedAccessToken: string | undefined;
  const service = new MetadataReviewsService(
    new MetadataReviewAggregator(
      {
        loadTitleSource: async () => ({
          identity: inferMediaIdentity({ mediaType: 'movie', tmdbId: 7 }),
          language: null,
          tmdbTitle,
          tmdbNextEpisode: null,
        }),
      } as never,
      { getReviews: async () => [buildStoredReview('tmdb-7', 'Primary review')] } as never,
      {
        isConfigured: () => true,
        fetchTitleReviews: async (_mediaType: 'movie' | 'show', _externalIds: { imdb: string | null; tmdb: number | null; tvdb: number | null }, _limit: number, options?: { accessToken?: string }) => {
          usedAccessToken = options?.accessToken;
          return [buildFallbackReview('trakt-fallback', 'Fallback review')];
        },
      } as never,
      {
        getAccessTokenForAccountProfile: async () => {
          const { HttpError } = await import('../../lib/errors.js');
          throw new HttpError(404, 'Provider connection not found.');
        },
      } as never,
    ),
    {} as never,
  );

  const reviews = await service.loadTitleReviews(
    {} as never,
    'user-1',
    'profile-1',
    inferMediaIdentity({ mediaType: 'movie', tmdbId: 7 }),
  );

  assert.equal(reviews.length, 2);
  assert.equal(usedAccessToken, undefined);
});
