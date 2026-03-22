import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { MetadataQueryService } from '../../modules/metadata/metadata-query.service.js';
import type { SupportedMediaType } from '../../modules/watch/media-key.js';

export async function registerMetadataRoutes(app: FastifyInstance): Promise<void> {
  const metadataQueryService = new MetadataQueryService();

  app.get('/v1/metadata/resolve', async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as Record<string, unknown>;

    return metadataQueryService.resolve({
      id: asUndefinedString(query.id),
      tmdbId: parseOptionalNumber(query.tmdbId),
      imdbId: asOptionalString(query.imdbId),
      tvdbId: parseOptionalNumber(query.tvdbId),
      mediaType: parseSupportedMediaType(query.mediaType),
      seasonNumber: parseOptionalNumber(query.seasonNumber),
      episodeNumber: parseOptionalNumber(query.episodeNumber),
    });
  });

  app.get('/v1/metadata/titles/:id', async (request) => {
    await app.requireAuth(request);
    const params = request.params as { id: string };
    return metadataQueryService.getTitleDetailById(params.id);
  });

  app.get('/v1/metadata/titles/:id/seasons/:seasonNumber', async (request) => {
    await app.requireAuth(request);
    const params = request.params as { id: string; seasonNumber: string };
    const seasonNumber = parseRequiredPositiveNumber(params.seasonNumber, 'seasonNumber');
    return metadataQueryService.getSeasonDetailByShowId(params.id, seasonNumber);
  });

  app.get('/v1/search/titles', async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const searchQuery = asOptionalString(query.query) ?? '';
    const limit = clampLimit(parseOptionalNumber(query.limit) ?? 20, 1, 50);
    return metadataQueryService.searchTitles(searchQuery, limit);
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

function parseRequiredPositiveNumber(value: string, field: string): number {
  const parsed = Number(value);
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

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
