import type { FastifyInstance } from 'fastify';
import {
  libraryRatingRouteSchema,
  libraryWatchlistRouteSchema,
  profileLibraryRouteSchema,
  providerAuthStateRouteSchema,
  type LibraryMutationBody,
  type LibraryProfileParams,
  type LibraryQuery,
} from '../contracts/library.js';
import { HttpError } from '../../lib/errors.js';
import { LibraryService } from '../../modules/library/library.service.js';
import type { LibraryMutationSource, LibraryProviderSource } from '../../modules/library/library.types.js';
import { ensureSupportedProvider } from '../../modules/watch/media-key.js';

export async function registerLibraryRoutes(app: FastifyInstance): Promise<void> {
  const libraryService = new LibraryService();

  app.get('/v1/profiles/:profileId/library', { schema: profileLibraryRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as Partial<LibraryProfileParams>;
    const query = (request.query ?? {}) as LibraryQuery;

    return libraryService.getProfileLibrary(actor.appUserId, getProfileIdFromParams(params), {
      source: parseLibrarySource(query.source),
      limitPerFolder: parseOptionalPositiveNumber(query.limitPerFolder, 'limitPerFolder'),
    });
  });

  app.get('/v1/profiles/:profileId/provider-auth/state', { schema: providerAuthStateRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as Partial<LibraryProfileParams>;
    const profileId = getProfileIdFromParams(params);

    await libraryService.requireOwnedProfile(actor.appUserId, profileId);
    return {
      providers: await libraryService.getProviderAuthState(actor.appUserId, profileId),
    };
  });

  app.post('/v1/profiles/:profileId/library/watchlist', { schema: libraryWatchlistRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as Partial<LibraryProfileParams>;
    const body = (request.body ?? {}) as LibraryMutationBody;

    return libraryService.setWatchlist(actor.appUserId, getProfileIdFromParams(params), {
      source: parseMutationSource(body.source),
      inWatchlist: parseRequiredBoolean(body.inWatchlist, 'inWatchlist'),
      ...parseResolveBody(body),
    });
  });

  app.post('/v1/profiles/:profileId/library/rating', { schema: libraryRatingRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as Partial<LibraryProfileParams>;
    const body = (request.body ?? {}) as LibraryMutationBody;

    return libraryService.setRating(actor.appUserId, getProfileIdFromParams(params), {
      source: parseMutationSource(body.source),
      rating: parseNullableRating(body.rating),
      ...parseResolveBody(body),
    });
  });
}

function getProfileIdFromParams(params: unknown): string {
  const profileId = typeof (params as { profileId?: unknown } | null)?.profileId === 'string'
    ? (params as { profileId: string }).profileId.trim()
    : '';
  if (!profileId) {
    throw new Error('Profile route is missing profileId param.');
  }
  return profileId;
}

function parseLibrarySource(value: unknown): LibraryProviderSource | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value === 'local' || value === 'trakt' || value === 'simkl' || value === 'all') {
    return value;
  }
  throw new HttpError(400, 'Invalid library source.');
}

function parseMutationSource(value: unknown): LibraryMutationSource | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value === 'trakt' || value === 'simkl' || value === 'all') {
    return value;
  }
  throw new HttpError(400, 'Invalid mutation source.');
}

function parseResolveBody(body: Record<string, unknown>) {
  const id = parseOptionalString(body.id);
  const provider = parseOptionalProvider(body.provider);
  const providerId = parseOptionalPositiveNumber(body.providerId, 'providerId');
  const parentProvider = parseOptionalProvider(body.parentProvider);
  const parentProviderId = parseOptionalPositiveNumber(body.parentProviderId, 'parentProviderId');
  const mediaType = parseOptionalSupportedMediaType(body.mediaType);
  const resolvedProviderInput = mapProviderReference(
    mediaType === 'episode' ? parentProvider : provider,
    mediaType === 'episode' ? parentProviderId : providerId,
  );
  return {
    id: id ?? undefined,
    tmdbId: resolvedProviderInput.tmdbId,
    imdbId: parseOptionalString(body.imdbId),
    tvdbId: resolvedProviderInput.tvdbId,
    kitsuId: resolvedProviderInput.kitsuId,
    mediaType,
    seasonNumber: parseOptionalPositiveNumber(body.seasonNumber, 'seasonNumber'),
    episodeNumber: parseOptionalPositiveNumber(body.episodeNumber, 'episodeNumber'),
  };
}

function parseOptionalPositiveNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `Invalid ${field}.`);
  }
  return parsed;
}

function parseNullableRating(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = parseOptionalPositiveNumber(value, 'rating');
  if (parsed === null || parsed > 10) {
    throw new HttpError(400, 'Invalid rating.');
  }
  return parsed;
}

function parseRequiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new HttpError(400, `Invalid ${field}.`);
  }
  return value;
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseOptionalProvider(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return ensureSupportedProvider(value.trim());
}

function parseOptionalSupportedMediaType(value: unknown): 'movie' | 'show' | 'anime' | 'episode' | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value === 'movie' || value === 'show' || value === 'anime' || value === 'episode') {
    return value;
  }
  throw new HttpError(400, 'Unsupported media type.');
}

function mapProviderReference(
  provider: ReturnType<typeof parseOptionalProvider>,
  providerId: number | null,
): {
  tmdbId: number | null;
  tvdbId: number | null;
  kitsuId: number | null;
} {
  if (provider === 'tmdb') {
    return { tmdbId: providerId, tvdbId: null, kitsuId: null };
  }
  if (provider === 'tvdb') {
    return { tmdbId: null, tvdbId: providerId, kitsuId: null };
  }
  if (provider === 'kitsu') {
    return { tmdbId: null, tvdbId: null, kitsuId: providerId };
  }
  return { tmdbId: null, tvdbId: null, kitsuId: null };
}
