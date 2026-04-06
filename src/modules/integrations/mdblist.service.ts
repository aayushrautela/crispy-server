import { logger } from '../../config/logger.js';
import { HttpError } from '../../lib/errors.js';
import { redis } from '../../lib/redis.js';
import { MdbListClient } from './mdblist.client.js';
import type {
  MdbListMediaType,
  MdbListRatingProvider,
  MdbListReturnRating,
  MdbListTitleRatingsView,
  MdbListTitleResponse,
  MdbListTitleView,
} from './mdblist.types.js';

const TITLE_TTL_SECONDS = 24 * 60 * 60;
const RATINGS_TTL_SECONDS = 7 * 24 * 60 * 60;

const RATING_SOURCE_MAP: Array<{ source: MdbListReturnRating; field: keyof MdbListTitleRatingsView['ratings'] }> = [
  { source: 'imdb', field: 'imdb' },
  { source: 'tmdb', field: 'tmdb' },
  { source: 'trakt', field: 'trakt' },
  { source: 'metacritic', field: 'metacritic' },
  { source: 'tomatoes', field: 'rottenTomatoes' },
  { source: 'audience', field: 'audience' },
  { source: 'letterboxd', field: 'letterboxd' },
  { source: 'rogerebert', field: 'rogerEbert' },
  { source: 'mal', field: 'myAnimeList' },
];

function titleCacheKey(mediaType: string, tmdbId: number): string {
  return `mdblist:title:${mediaType}:${tmdbId}`;
}

function ratingsCacheKey(provider: string, providerId: string): string {
  return `mdblist:ratings:${provider}:${providerId}`;
}

function buildTitleView(response: MdbListTitleResponse): MdbListTitleView {
  return {
    ids: {
      imdb: response.ids?.imdb ?? null,
      tmdb: response.ids?.tmdb ?? null,
      trakt: response.ids?.trakt ?? null,
      tvdb: response.ids?.tvdb ?? null,
    },
    title: response.title ?? null,
    originalTitle: response.original_title ?? null,
    type: response.type ?? null,
    year: response.year ?? null,
    description: response.description ?? null,
    score: response.score ?? null,
    ratings: {
      imdbRating: response.ratings?.imdb_rating ?? null,
      imdbVotes: response.ratings?.imdb_votes ?? null,
      tmdbRating: response.ratings?.tmdb_rating ?? null,
      metacritic: response.ratings?.metacritic ?? null,
      rottenTomatoes: response.ratings?.rotten_tomatoes ?? null,
      letterboxdRating: response.ratings?.letterboxd_rating ?? null,
    },
    posterUrl: response.poster ?? null,
    backdropUrl: response.backdrop ?? null,
    genres: Array.isArray(response.genres) ? response.genres.map((g) => g.name) : [],
    keywords: Array.isArray(response.keywords) ? response.keywords.map((k) => k.name) : [],
    runtime: response.runtime ?? null,
    certification: response.age_rating ?? response.us_rating ?? null,
    released: response.released ?? null,
    language: response.language ?? null,
    country: response.country ?? null,
    seasonCount: response.season_count ?? null,
    episodeCount: response.episode_count ?? null,
    directors: Array.isArray(response.directors) ? response.directors.map((d) => d.name) : [],
    writers: Array.isArray(response.writers) ? response.writers.map((w) => w.name) : [],
    network: response.network ?? null,
    studio: response.studio ?? null,
    status: response.status ?? null,
    budget: response.budget ?? null,
    revenue: response.revenue ?? null,
    updatedAt: response.updated_at ?? null,
  };
}

export class MdbListService {
  constructor(private readonly client: MdbListClient) {}

  async getTitle(apiKey: string, mediaType: MdbListMediaType, tmdbId: number): Promise<MdbListTitleView | null> {
    const cacheKey = titleCacheKey(mediaType, tmdbId);
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as MdbListTitleView;
    }

    try {
      const response = await this.client.fetchTitle(apiKey, mediaType, tmdbId);
      const view = buildTitleView(response);
      await redis.set(cacheKey, JSON.stringify(view), 'EX', TITLE_TTL_SECONDS);
      return view;
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) {
        return null;
      }
      logger.warn({ err: error, mediaType, tmdbId }, 'Failed to fetch MDBList title');
      return null;
    }
  }

  async getTitleRatings(
    apiKey: string,
    mediaType: MdbListMediaType,
    lookup: { provider: MdbListRatingProvider; id: number | string },
  ): Promise<MdbListTitleRatingsView | null> {
    const cacheKey = ratingsCacheKey(`${mediaType}:${lookup.provider}`, String(lookup.id));
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as MdbListTitleRatingsView;
    }

    const ratings: MdbListTitleRatingsView['ratings'] = {
      imdb: null,
      tmdb: null,
      trakt: null,
      metacritic: null,
      rottenTomatoes: null,
      audience: null,
      letterboxd: null,
      rogerEbert: null,
      myAnimeList: null,
    };

    const results = await Promise.all(RATING_SOURCE_MAP.map(async ({ source, field }) => {
      try {
        const response = await this.client.fetchRatings(apiKey, mediaType, source, {
          provider: lookup.provider,
          ids: [lookup.id],
        });
        const match = response.ratings.find((entry) => String(entry.id) === String(lookup.id));
        ratings[field] = match?.rating ?? null;
        return true;
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404) {
          return false;
        }
        logger.warn({ err: error, mediaType, provider: lookup.provider, providerId: lookup.id, source }, 'Failed to fetch MDBList rating source');
        return false;
      }
    }));

    if (results.every((result) => result === false)) {
      return null;
    }

    const view = { ratings } satisfies MdbListTitleRatingsView;
    await redis.set(cacheKey, JSON.stringify(view), 'EX', RATINGS_TTL_SECONDS);
    return view;
  }

  async invalidateTitle(mediaType: string, tmdbId: number): Promise<void> {
    await redis.del(titleCacheKey(mediaType, tmdbId));
  }

  async invalidateRatings(provider: string, providerId: string): Promise<void> {
    await redis.del(ratingsCacheKey(provider, providerId));
  }
}
