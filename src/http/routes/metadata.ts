import type { FastifyInstance } from 'fastify';
import {
  metadataEpisodesRouteSchema,
  metadataNextEpisodeRouteSchema,
  metadataPersonRouteSchema,
  metadataResolveRouteSchema,
  metadataSearchRouteSchema,
  metadataSeasonRouteSchema,
  metadataTitleContentRouteSchema,
  metadataTitleDetailRouteSchema,
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
import { MetadataDetailService } from '../../modules/metadata/metadata-detail.service.js';
import { EpisodeNavigationService } from '../../modules/metadata/episode-navigation.service.js';
import { MetadataContentService } from '../../modules/metadata/metadata-content.service.js';
import { PersonDetailService } from '../../modules/metadata/person-detail.service.js';
import { PlaybackResolveService } from '../../modules/metadata/playback-resolve.service.js';
import type { MetadataSearchFilter } from '../../modules/metadata/metadata-detail.types.js';
import type { SupportedMediaType } from '../../modules/identity/media-key.js';
import { ensureSupportedProvider } from '../../modules/identity/media-key.js';
import { TitleSearchService } from '../../modules/search/title-search.service.js';

export async function registerMetadataRoutes(app: FastifyInstance): Promise<void> {
  const metadataDetailService = new MetadataDetailService();
  const titleSearchService = new TitleSearchService();
  const metadataContentService = new MetadataContentService();
  const personDetailService = new PersonDetailService();
  const episodeNavigationService = new EpisodeNavigationService();
  const playbackResolveService = new PlaybackResolveService();

  app.get('/v1/metadata/resolve', { schema: metadataResolveRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataResolveQuery;
    const resolvedProviderInput = mapProviderResolveQuery(query);

    return metadataDetailService.resolve({
      mediaKey: asUndefinedString(query.mediaKey),
      tmdbId: resolvedProviderInput.tmdbId,
      imdbId: asOptionalString(query.imdbId),
      tvdbId: resolvedProviderInput.tvdbId,
      kitsuId: resolvedProviderInput.kitsuId,
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

  app.get('/v1/metadata/titles/:mediaKey/content', { schema: metadataTitleContentRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as MetadataTitleParams;
    return metadataContentService.getTitleContent(actor.appUserId, params.mediaKey);
  });

  app.get('/v1/metadata/titles/:mediaKey/seasons/:seasonNumber', { schema: metadataSeasonRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataSeasonParams;
    const query = (request.query ?? {}) as MetadataPersonQuery;
    const seasonNumber = parseRequiredPositiveNumber(params.seasonNumber, 'seasonNumber');
    return metadataDetailService.getSeasonDetailByShowId(params.mediaKey, seasonNumber, asOptionalString(query.language));
  });

  app.get('/v1/metadata/people/:id', { schema: metadataPersonRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataPersonParams;
    const query = (request.query ?? {}) as MetadataPersonQuery;
    return personDetailService.getPersonDetail(params.id, asOptionalString(query.language));
  });

  app.get('/v1/metadata/titles/:mediaKey/episodes', { schema: metadataEpisodesRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataTitleParams;
    const query = (request.query ?? {}) as MetadataEpisodesQuery;
    return episodeNavigationService.listEpisodes(
      params.mediaKey,
      parseOptionalPositiveNumber(query.seasonNumber, 'seasonNumber'),
      asOptionalString(query.language),
    );
  });

  app.get('/v1/metadata/titles/:mediaKey/next-episode', { schema: metadataNextEpisodeRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataTitleParams;
    const query = (request.query ?? {}) as MetadataNextEpisodeQuery;
    return episodeNavigationService.getNextEpisode(params.mediaKey, {
      currentSeasonNumber: parseRequiredPositiveQueryNumber(query.currentSeasonNumber, 'currentSeasonNumber'),
      currentEpisodeNumber: parseRequiredPositiveQueryNumber(query.currentEpisodeNumber, 'currentEpisodeNumber'),
      watchedKeys: parseStringList(query.watchedKeys),
      showMediaKey: asOptionalString(query.showMediaKey),
      nowMs: parseOptionalNumber(query.nowMs),
      language: asOptionalString(query.language),
    });
  });

  app.get('/v1/playback/resolve', { schema: playbackResolveRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataResolveQuery;
    const resolvedProviderInput = mapProviderResolveQuery(query);
    return playbackResolveService.resolvePlayback({
      mediaKey: asUndefinedString(query.mediaKey),
      tmdbId: resolvedProviderInput.tmdbId,
      imdbId: asOptionalString(query.imdbId),
      tvdbId: resolvedProviderInput.tvdbId,
      kitsuId: resolvedProviderInput.kitsuId,
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

function parseOptionalProvider(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return ensureSupportedProvider(value.trim());
}

function mapProviderResolveQuery(query: MetadataResolveQuery): {
  tmdbId: number | null;
  tvdbId: number | null;
  kitsuId: string | number | null;
} {
  const mediaType = parseSupportedMediaType(query.mediaType);
  const provider = parseOptionalProvider(query.provider);
  const providerId = parseOptionalStringOrNumber(query.providerId);
  const parentProvider = parseOptionalProvider(query.parentProvider);
  const parentProviderId = parseOptionalStringOrNumber(query.parentProviderId);

  if (mediaType === 'episode') {
    return mapProviderReference(parentProvider, parentProviderId);
  }

  return mapProviderReference(provider, providerId);
}

function mapProviderReference(
  provider: ReturnType<typeof parseOptionalProvider>,
  providerId: string | number | null,
): {
  tmdbId: number | null;
  tvdbId: number | null;
  kitsuId: string | number | null;
} {
  if (provider === 'tmdb') {
    return {
      tmdbId: parseOptionalNumber(providerId),
      tvdbId: null,
      kitsuId: null,
    };
  }

  if (provider === 'tvdb') {
    return {
      tmdbId: null,
      tvdbId: parseOptionalNumber(providerId),
      kitsuId: null,
    };
  }

  if (provider === 'kitsu') {
    return {
      tmdbId: null,
      tvdbId: null,
      kitsuId: providerId,
    };
  }

  return {
    tmdbId: null,
    tvdbId: null,
    kitsuId: null,
  };
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
