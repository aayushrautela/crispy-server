import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { LibraryService } from '../../modules/library/library.service.js';
import type { LibraryProviderSource } from '../../modules/library/library.types.js';

export async function registerLibraryRoutes(app: FastifyInstance): Promise<void> {
  const libraryService = new LibraryService();

  app.get('/v1/profiles/:profileId/library', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string };
    const query = (request.query ?? {}) as Record<string, unknown>;

    return libraryService.getProfileLibrary(actor.appUserId, getProfileIdFromParams(params), {
      source: parseLibrarySource(query.source),
      limitPerFolder: parseOptionalPositiveNumber(query.limitPerFolder, 'limitPerFolder'),
    });
  });

  app.get('/v1/profiles/:profileId/provider-auth/state', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string };
    const profileId = getProfileIdFromParams(params);

    await libraryService.requireOwnedProfile(actor.appUserId, profileId);
    return {
      providers: await libraryService.getProviderAuthState(profileId),
    };
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
