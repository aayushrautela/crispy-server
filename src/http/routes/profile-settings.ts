import type { FastifyInstance } from 'fastify';
import type { SupabaseProfileService } from '../../modules/profiles/supabase-profile.service.js';
import { success } from '../response.js';

export async function registerProfileSettingsRoutes(
  app: FastifyInstance,
  opts: { supabaseProfileService: SupabaseProfileService },
): Promise<void> {
  const profileService = opts.supabaseProfileService;

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
}
