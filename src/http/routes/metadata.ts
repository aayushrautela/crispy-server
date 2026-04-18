import type { FastifyInstance } from 'fastify';
import {
  metadataPersonRouteSchema,
  metadataResolveRouteSchema,
  metadataSearchRouteSchema,
  metadataTitleDetailRouteSchema,
  metadataTitleRatingsRouteSchema,
  metadataTitleReviewsRouteSchema,
  playbackResolveRouteSchema,
  type MetadataPersonParams,
  type MetadataPersonQuery,
  type MetadataResolveQuery,
  type MetadataSearchQuery,
  type MetadataTitleParams,
} from '../contracts/metadata.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataDetailService } from '../../modules/metadata/metadata-detail.service.js';
import { PersonDetailService } from '../../modules/metadata/person-detail.service.js';
import { PlaybackResolveService } from '../../modules/metadata/playback-resolve.service.js';
import { MetadataRatingsService } from '../../modules/metadata/metadata-ratings.service.js';
import { MetadataReviewsService } from '../../modules/metadata/metadata-reviews.service.js';
import type { MetadataSearchFilter } from '../../modules/metadata/metadata-detail.types.js';
import type { SupportedMediaType } from '../../modules/identity/media-key.js';
import { TitleSearchService } from '../../modules/search/title-search.service.js';

export async function registerMetadataRoutes(app: FastifyInstance): Promise<void> {
  const metadataDetailService = new MetadataDetailService();
  const titleSearchService = new TitleSearchService();
  const metadataRatingsService = new MetadataRatingsService();
  const metadataReviewsService = new MetadataReviewsService();
  const personDetailService = new PersonDetailService();
  const playbackResolveService = new PlaybackResolveService();

  app.get('/v1/metadata/resolve', { schema: metadataResolveRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataResolveQuery;

    return metadataDetailService.resolve({
      mediaKey: asUndefinedString(query.mediaKey),
      tmdbId: parseOptionalPositiveNumber(query.tmdbId, 'tmdbId'),
      imdbId: asOptionalString(query.imdbId),
      mediaType: parseSupportedMediaType(query.mediaType),
      seasonNumber: parseOptionalNumber(query.seasonNumber),
      episodeNumber: parseOptionalNumber(query.episodeNumber),
      language: asOptionalString(query.language),
    });
  });

  app.get('/v1/metadata/titles/:mediaKey', { schema: metadataTitleDetailRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataTitleParams;
    const query = (request.query ?? {}) as MetadataPersonQuery;
    return metadataDetailService.getTitleDetailById(params.mediaKey, asOptionalString(query.language));
  });

  app.get('/v1/profiles/:profileId/metadata/titles/:mediaKey/reviews', { schema: metadataTitleReviewsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string; mediaKey: string };
    const query = (request.query ?? {}) as MetadataPersonQuery;
    return metadataReviewsService.getTitleReviews(actor.appUserId, params.profileId, params.mediaKey, asOptionalString(query.language));
  });

  app.get('/v1/profiles/:profileId/metadata/titles/:mediaKey/ratings', { schema: metadataTitleRatingsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string; mediaKey: string };
    return metadataRatingsService.getTitleRatings(actor.appUserId, params.profileId, params.mediaKey);
  });

  app.get('/v1/metadata/people/:id', { schema: metadataPersonRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataPersonParams;
    const query = (request.query ?? {}) as MetadataPersonQuery;
    return personDetailService.getPersonDetail(params.id, asOptionalString(query.language));
  });

  app.get('/v1/playback/resolve', { schema: playbackResolveRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataResolveQuery;
    return playbackResolveService.resolvePlayback({
      mediaKey: asUndefinedString(query.mediaKey),
      tmdbId: parseOptionalPositiveNumber(query.tmdbId, 'tmdbId'),
      imdbId: asOptionalString(query.imdbId),
      mediaType: parseSupportedMediaType(query.mediaType),
      seasonNumber: parseOptionalPositiveNumber(query.seasonNumber, 'seasonNumber'),
      episodeNumber: parseOptionalPositiveNumber(query.episodeNumber, 'episodeNumber'),
      language: asOptionalString(query.language),
    });
  });

  app.get('/v1/search/titles', { schema: metadataSearchRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataSearchQuery;
    const searchQuery = asOptionalString(query.query) ?? '';
    const genre = asOptionalString(query.genre);
    const filter = parseSearchFilter(query.filter);
    const limit = clampLimit(parseOptionalNumber(query.limit) ?? 20, 1, 50);
    return titleSearchService.searchTitles({ query: searchQuery, genre, filter, limit });
  });
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asUndefinedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseOptionalPositiveNumber(value: unknown, field: string): number | null {
  const parsed = parseOptionalNumber(value);
  if (parsed === null) {
    return null;
  }
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `Invalid ${field}.`);
  }
  return parsed;
}

function parseSupportedMediaType(value: unknown): SupportedMediaType | null {
  if (value === 'movie' || value === 'show' || value === 'episode') {
    return value;
  }
  return null;
}

function parseSearchFilter(value: unknown): MetadataSearchFilter {
  if (value === 'movies' || value === 'series') {
    return value;
  }
  if (value === undefined || value === null || value === '' || value === 'all') {
    return 'all';
  }
  throw new HttpError(400, 'Invalid search filter.');
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
