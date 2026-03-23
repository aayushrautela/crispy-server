import type { FastifyInstance } from 'fastify';
import { HomeService } from '../../modules/home/home.service.js';

export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  const homeService = new HomeService();

  app.get('/v1/home', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = app.requireProfileId(request);
    return homeService.getHome(actor.appUserId, profileId);
  });
}
