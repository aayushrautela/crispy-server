import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import type { MetadataReviewView } from './metadata-detail.types.js';
import type { ProviderTitleRecord } from './metadata-card.types.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';

setTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-test-id' });

function buildTmdbReview(id: string, content: string): Record<string, unknown> {
  return {
    id,
    author: 'Critic',
    content,
    url: `https://example.com/reviews/${id}`,
    created_at: '2024-01-02T00:00:00.000Z',
    updated_at: '2024-01-03T00:00:00.000Z',
    author_details: { username: `critic-${id}`, rating: 8 },
  };
}

function buildFallbackReview(id: string, content: string): MetadataReviewView {
  return {
    id,
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

test('MetadataDetailCoreService tops up TMDB movie reviews from Trakt when under threshold', async () => {
  const { MetadataDetailCoreService } = await import('./metadata-detail-core.service.js');

  const tmdbTitle: TmdbTitleRecord = {
    mediaType: 'movie',
    tmdbId: 42,
    name: 'Batman Begins',
    originalName: 'Batman Begins',
    overview: 'A bat starts.',
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
      reviews: { results: [buildTmdbReview('tmdb-1', 'TMDB review')] },
      production_companies: [],
      networks: [],
      production_countries: [],
      spoken_languages: [],
      similar: { results: [] },
    },
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const traktCalls: Array<{ mediaType: 'movie' | 'show'; externalIds: { imdb: string | null; tmdb: number | null; tvdb: number | null } }> = [];
  const service = new MetadataDetailCoreService(
    { getTitle: async () => tmdbTitle } as never,
    {
      ensureSeasonContentIds: async () => new Map(),
      ensureContentIds: async () => new Map(),
    } as never,
    { loadIdentityContext: async () => null } as never,
    {
      isConfigured: () => true,
      fetchTitleReviews: async (mediaType: 'movie' | 'show', externalIds: { imdb: string | null; tmdb: number | null; tvdb: number | null }) => {
        traktCalls.push({ mediaType, externalIds });
        return [
          buildFallbackReview('trakt-1', 'Trakt review 1'),
          buildFallbackReview('trakt-2', 'Trakt review 2'),
        ];
      },
    } as never,
  );

  const detail = await service.getTitleDetail({} as never, inferMediaIdentity({ mediaType: 'movie', tmdbId: 42 }));

  assert.equal(detail.reviews.length, 3);
  assert.equal(detail.reviews[0]?.id, 'tmdb-1');
  assert.equal(detail.reviews[1]?.id, 'trakt-1');
  assert.equal(detail.reviews[2]?.id, 'trakt-2');
  assert.deepEqual(traktCalls, [{ mediaType: 'movie', externalIds: { imdb: 'tt0372784', tmdb: 42, tvdb: null, kitsu: null } }]);
});

test('MetadataDetailCoreService tops up anime reviews from Trakt through provider detail flow', async () => {
  const { MetadataDetailCoreService } = await import('./metadata-detail-core.service.js');

  const providerTitle: ProviderTitleRecord = {
    mediaType: 'anime',
    provider: 'kitsu',
    providerId: '12',
    title: 'One Piece',
    originalTitle: 'One Piece',
    summary: 'Pirates.',
    overview: 'Pirates.',
    releaseDate: '1999-10-20',
    status: 'current',
    posterUrl: 'https://cdn.example/poster.jpg',
    backdropUrl: 'https://cdn.example/backdrop.jpg',
    logoUrl: null,
    runtimeMinutes: 24,
    rating: 8.4,
    certification: 'Teens 13 or older',
    genres: [],
    externalIds: { imdb: null, tmdb: 555, tvdb: null, kitsu: '12' },
    seasonCount: null,
    episodeCount: 1000,
    raw: { data: { attributes: {} } },
  };

  let traktMediaType: 'movie' | 'show' | null = null;
  const service = new MetadataDetailCoreService(
    {} as never,
    {
      ensureSeasonContentIds: async () => new Map(),
      ensureContentIds: async () => new Map(),
    } as never,
    {
      loadIdentityContext: async () => ({
        title: providerTitle,
        currentEpisode: null,
        nextEpisode: null,
        seasons: [],
        episodes: [],
        videos: [],
        cast: [],
        directors: [],
        creators: [],
        reviews: [{
          id: 'kitsu-1',
          author: 'Kitsu',
          username: 'kitsu',
          content: 'Kitsu review',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          url: null,
          rating: 8,
          avatarUrl: null,
        }],
        production: null,
        collection: null,
        similar: [],
      }),
    } as never,
    {
      isConfigured: () => true,
      fetchTitleReviews: async (mediaType: 'movie' | 'show') => {
        traktMediaType = mediaType;
        return [
          buildFallbackReview('trakt-a', 'Trakt anime review 1'),
          buildFallbackReview('trakt-b', 'Trakt anime review 2'),
        ];
      },
    } as never,
  );

  const detail = await service.getTitleDetail({} as never, inferMediaIdentity({ mediaType: 'anime', provider: 'kitsu', providerId: '12' }));

  assert.equal(detail.reviews.length, 3);
  assert.equal(detail.reviews[0]?.id, 'kitsu-1');
  assert.equal(traktMediaType, 'show');
});

test('MetadataDetailCoreService skips Trakt fallback when three primary reviews already exist', async () => {
  const { MetadataDetailCoreService } = await import('./metadata-detail-core.service.js');

  const providerTitle: ProviderTitleRecord = {
    mediaType: 'show',
    provider: 'tvdb',
    providerId: '81189',
    title: 'Breaking Bad',
    originalTitle: 'Breaking Bad',
    summary: 'Chemistry.',
    overview: 'Chemistry.',
    releaseDate: '2008-01-20',
    status: 'Ended',
    posterUrl: 'https://cdn.example/poster.jpg',
    backdropUrl: 'https://cdn.example/backdrop.jpg',
    logoUrl: null,
    runtimeMinutes: 45,
    rating: 9.5,
    certification: 'TV-MA',
    genres: ['Drama'],
    externalIds: { imdb: 'tt0903747', tmdb: 1396, tvdb: 81189, kitsu: null },
    seasonCount: 5,
    episodeCount: 62,
    raw: {},
  };

  let traktCalled = false;
  const service = new MetadataDetailCoreService(
    {} as never,
    {
      ensureSeasonContentIds: async () => new Map(),
      ensureContentIds: async () => new Map(),
    } as never,
    {
      loadIdentityContext: async () => ({
        title: providerTitle,
        currentEpisode: null,
        nextEpisode: null,
        seasons: [],
        episodes: [],
        videos: [],
        cast: [],
        directors: [],
        creators: [],
        reviews: [
          buildFallbackReview('provider-1', 'Provider review 1'),
          buildFallbackReview('provider-2', 'Provider review 2'),
          buildFallbackReview('provider-3', 'Provider review 3'),
        ],
        production: null,
        collection: null,
        similar: [],
      }),
    } as never,
    {
      isConfigured: () => true,
      fetchTitleReviews: async () => {
        traktCalled = true;
        return [];
      },
    } as never,
  );

  const detail = await service.getTitleDetail({} as never, inferMediaIdentity({ mediaType: 'show', provider: 'tvdb', providerId: '81189' }));

  assert.equal(detail.reviews.length, 3);
  assert.equal(traktCalled, false);
});
