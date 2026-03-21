import type { FastifyInstance } from 'fastify';
import { ProfileService } from '../../modules/profiles/profile.service.js';

export async function registerProfileSettingsRoutes(app: FastifyInstance): Promise<void> {
  const profileService = new ProfileService();

  app.get('/v1/profiles/:profileId/settings', async (request) => {
    await app.requireAuth(request);
    const params = request.params as { profileId: string };
    return {
      settings: await profileService.getSettings(request.auth!.appUserId, params.profileId),
    };
  });

  app.patch('/v1/profiles/:profileId/settings', async (request) => {
    await app.requireAuth(request);
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return {
      settings: await profileService.patchSettings(request.auth!.appUserId, params.profileId, body),
    };
  });
}
