import type { FastifyInstance } from 'fastify';
import { ProfileService } from '../../modules/profiles/profile.service.js';

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  const profileService = new ProfileService();

  app.get('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    return {
      profiles: await profileService.listForUser(request.auth!.appUserId),
    };
  });

  app.post('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.create(request.auth!.appUserId, {
      name: String(body.name ?? '').trim(),
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : null,
      isKids: Boolean(body.isKids),
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return { profile };
  });

  app.patch('/v1/profiles/:profileId', async (request) => {
    await app.requireAuth(request);
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.update(request.auth!.appUserId, params.profileId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : undefined,
      isKids: typeof body.isKids === 'boolean' ? body.isKids : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return { profile };
  });
}
