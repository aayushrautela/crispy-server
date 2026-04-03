import type { FastifyInstance } from 'fastify';
import { profileHomeRouteSchema } from '../contracts/home.js';
import { HttpError } from '../../lib/errors.js';
import { HomeService } from '../../modules/home/home.service.js';

export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  const homeService = new HomeService();

  app.get('/v1/profiles/:profileId/home', { schema: profileHomeRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string };
    const profileId = getProfileIdFromParams(params);
    return homeService.getHome(actor.appUserId, profileId);
  });
}

function getProfileIdFromParams(params: { profileId?: string }): string {
  const profileId = params.profileId?.trim();
  if (!profileId) {
    throw new HttpError(400, 'Profile route is missing profileId param.');
  }
  return profileId;
}
