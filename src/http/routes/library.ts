import type { FastifyInstance } from 'fastify';
import { profileLibraryRouteSchema } from '../contracts/library.js';
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
}

function getProfileIdFromParams(params: { profileId?: string }): string {
  const profileId = params.profileId?.trim();
  if (!profileId) {
    throw new HttpError(400, 'Profile route is missing profileId param.');
  }
  return profileId;
}
