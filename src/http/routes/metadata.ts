import type { FastifyInstance } from 'fastify';
import {
  metadataEpisodesRouteSchema,
  metadataNextEpisodeRouteSchema,
  metadataPersonRouteSchema,
  metadataResolveRouteSchema,
  metadataSearchRouteSchema,
  metadataSeasonRouteSchema,
  metadataTitleParamsRouteSchema,
  playbackResolveRouteSchema,
  type MetadataEpisodesQuery,
  type MetadataNextEpisodeQuery,
  type MetadataPersonParams,
  type MetadataPersonQuery,
  type MetadataResolveQuery,
  type MetadataSearchQuery,
  type MetadataSeasonParams,
  type MetadataTitleParams,
} from '../contracts/metadata.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataDirectService } from '../../modules/metadata/metadata-direct.service.js';
import { MetadataQueryService } from '../../modules/metadata/metadata-query.service.js';
import type { MetadataSearchFilter } from '../../modules/metadata/metadata.types.js';
import type { SupportedMediaType } from '../../modules/watch/media-key.js';

export async function registerMetadataRoutes(app: FastifyInstance): Promise<void> {
  const metadataQueryService = new MetadataQueryService();
  const metadataDirectService = new MetadataDirectService();

  app.get('/v1/metadata/resolve', { schema: metadataResolveRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataResolveQuery;

    return metadataQueryService.resolve({
      id: asUndefinedString(query.id),
      tmdbId: parseOptionalNumber(query.tmdbId),
      imdbId: asOptionalString(query.imdbId),
      tvdbId: parseOptionalNumber(query.tvdbId),
      kitsuId: parseOptionalStringOrNumber(query.kitsuId),
      mediaType: parseSupportedMediaType(query.mediaType),
      seasonNumber: parseOptionalNumber(query.seasonNumber),
      episodeNumber: parseOptionalNumber(query.episodeNumber),
    });
  });

  app.get('/v1/metadata/titles/:id', { schema: metadataTitleParamsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataTitleParams;
    return metadataQueryService.getTitleDetailById(params.id);
  });

  app.get('/v1/metadata/titles/:id/content', { schema: metadataTitleParamsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as MetadataTitleParams;
    return metadataDirectService.getTitleContent(actor.appUserId, params.id);
  });

  app.get('/v1/metadata/titles/:id/seasons/:seasonNumber', { schema: metadataSeasonRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataSeasonParams;
    const seasonNumber = parseRequiredPositiveNumber(params.seasonNumber, 'seasonNumber');
    return metadataQueryService.getSeasonDetailByShowId(params.id, seasonNumber);
  });

  app.get('/v1/metadata/people/:id', { schema: metadataPersonRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataPersonParams;
    const query = (request.query ?? {}) as MetadataPersonQuery;
    return metadataDirectService.getPersonDetail(params.id, asOptionalString(query.language));
  });

  app.get('/v1/metadata/titles/:id/episodes', { schema: metadataEpisodesRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataTitleParams;
    const query = (request.query ?? {}) as MetadataEpisodesQuery;
    return metadataDirectService.listEpisodes(params.id, parseOptionalPositiveNumber(query.seasonNumber, 'seasonNumber'));
  });

  app.get('/v1/metadata/titles/:id/next-episode', { schema: metadataNextEpisodeRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataTitleParams;
    const query = (request.query ?? {}) as MetadataNextEpisodeQuery;
    return metadataDirectService.getNextEpisode(params.id, {
      currentSeasonNumber: parseRequiredPositiveQueryNumber(query.currentSeasonNumber, 'currentSeasonNumber'),
      currentEpisodeNumber: parseRequiredPositiveQueryNumber(query.currentEpisodeNumber, 'currentEpisodeNumber'),
      watchedKeys: parseStringList(query.watchedKeys),
      showId: asOptionalString(query.showId),
      nowMs: parseOptionalNumber(query.nowMs),
    });
  });

  app.get('/v1/playback/resolve', { schema: playbackResolveRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataResolveQuery;
    return metadataDirectService.resolvePlayback({
      id: asUndefinedString(query.id),
      tmdbId: parseOptionalNumber(query.tmdbId),
      imdbId: asOptionalString(query.imdbId),
      tvdbId: parseOptionalNumber(query.tvdbId),
      kitsuId: parseOptionalStringOrNumber(query.kitsuId),
      mediaType: parseSupportedMediaType(query.mediaType),
      seasonNumber: parseOptionalPositiveNumber(query.seasonNumber, 'seasonNumber'),
      episodeNumber: parseOptionalPositiveNumber(query.episodeNumber, 'episodeNumber'),
    });
  });

  app.get('/v1/search/titles', { schema: metadataSearchRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataSearchQuery;
    const searchQuery = asOptionalString(query.query) ?? '';
    const genre = asOptionalString(query.genre);
    const filter = parseSearchFilter(query.filter);
    const limit = clampLimit(parseOptionalNumber(query.limit) ?? 20, 1, 50);
    return metadataQueryService.searchTitles({ query: searchQuery, genre, filter, limit });
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

function parseRequiredPositiveQueryNumber(value: unknown, field: string): number {
  const parsed = parseOptionalPositiveNumber(value, field);
  if (parsed === null) {
    throw new HttpError(400, `Missing ${field}.`);
  }
  return parsed;
}

function parseRequiredPositiveNumber(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `Invalid ${field}.`);
  }
  return parsed;
}

function parseSupportedMediaType(value: unknown): SupportedMediaType | null {
  if (value === 'movie' || value === 'show' || value === 'anime' || value === 'episode') {
    return value;
  }
  return null;
}

function parseSearchFilter(value: unknown): MetadataSearchFilter {
  if (value === 'movies' || value === 'series' || value === 'anime') {
    return value;
  }
  if (value === undefined || value === null || value === '' || value === 'all') {
    return 'all';
  }
  throw new HttpError(400, 'Invalid search filter.');
}

function parseOptionalStringOrNumber(value: unknown): string | number | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function parseStringList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const items = value
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
      .map((entry) => entry.trim())
      .filter(Boolean);
    return items.length ? items : null;
  }

  if (typeof value === 'string') {
    const items = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return items.length ? items : null;
  }

  return null;
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
