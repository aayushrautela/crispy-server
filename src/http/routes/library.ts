import type { FastifyInstance } from 'fastify';
import { profileLibraryRouteSchema, profileLibrarySectionRouteSchema } from '../contracts/library.js';
import { HttpError } from '../../lib/errors.js';
import { LibraryService } from '../../modules/library/library.service.js';

export async function registerLibraryRoutes(app: FastifyInstance): Promise<void> {
  const libraryService = new LibraryService();

  app.get('/v1/profiles/:profileId/library', { schema: profileLibraryRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string };
    const profileId = getProfileIdFromParams(params);

    return libraryService.getProfileLibrary(actor.appUserId, profileId);
  });

  app.get('/v1/profiles/:profileId/library/sections/:sectionId', { schema: profileLibrarySectionRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string; sectionId?: string };
    const profileId = getProfileIdFromParams(params);
    const sectionId = getSectionIdFromParams(params);
    const query = (request.query ?? {}) as { limit?: number | string; cursor?: string };

    return libraryService.getProfileLibrarySectionPage(actor.appUserId, profileId, sectionId, {
      limit: Number(query.limit ?? 50),
      cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
    });
  });
}

function getProfileIdFromParams(params: { profileId?: string }): string {
  const profileId = params.profileId?.trim();
  if (!profileId) {
    throw new HttpError(400, 'Profile route is missing profileId param.');
  }
  return profileId;
}

function getSectionIdFromParams(params: { sectionId?: string }): string {
  const sectionId = params.sectionId?.trim();
  if (!sectionId) {
    throw new HttpError(400, 'Library section route is missing sectionId param.');
  }
  return sectionId;
}
