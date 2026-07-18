import type { FastifyInstance } from 'fastify';
import type { ProfileLocalService } from '../../modules/profiles/profile-local.service.js';
import { HomeModeService } from '../../modules/homescreen/home-mode.service.js';
import { success } from '../response.js';

export async function registerProfileSettingsRoutes(
  app: FastifyInstance,
  opts: { profileService: ProfileLocalService },
): Promise<void> {
  const profileService = opts.profileService;
  const homeModeService = new HomeModeService();

  app.get('/v1/profiles/:profileId/settings', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    return success({
      settings: await profileService.getSettings(actor.authSubject, params.profileId),
    }, request);
  });

  app.patch('/v1/profiles/:profileId/settings', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success({
      settings: await profileService.patchSettings(actor.authSubject, params.profileId, body),
    }, request);
  });

  app.get('/v1/profiles/:profileId/home-mode', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    return success({
      mode: await homeModeService.getMode(actor.authSubject, params.profileId),
    }, request);
  });

  app.put('/v1/profiles/:profileId/home-mode', async (request) => {
    await app.requireAuth(request);
    app.requireScopes(request, ['recommendations:write']);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const mode = typeof body.mode === 'string' ? body.mode : '';
    return success({
      mode: await homeModeService.setMode(actor.authSubject, params.profileId, mode as never),
    }, request);
  });
}
