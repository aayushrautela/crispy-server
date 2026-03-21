import type { FastifyInstance } from 'fastify';
import { HomeService } from '../../modules/home/home.service.js';

export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  const homeService = new HomeService();

  app.get('/v1/home', async (request) => {
    await app.requireAuth(request);
    const profileId = app.requireProfileId(request);
    return homeService.getHome(request.auth!.appUserId, profileId);
  });
}
