import type { FastifyInstance } from 'fastify';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import type { SupabaseProfileService } from '../../modules/profiles/supabase-profile.service.js';
import { success } from '../response.js';

export async function registerProfileSettingsRoutes(
  app: FastifyInstance,
  opts?: { supabaseProfileService?: SupabaseProfileService },
): Promise<void> {
  const profileService = new ProfileService();
  const supabaseProfileService = opts?.supabaseProfileService;

  app.get('/v1/profiles/:profileId/settings', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string; authSubject: string };
    const params = request.params as { profileId: string };
    return success({
      settings: supabaseProfileService
        ? await supabaseProfileService.getSettings(actor.authSubject, params.profileId)
        : await profileService.getSettingsForAccount(actor.appUserId, params.profileId),
    }, request);
  });

  app.patch('/v1/profiles/:profileId/settings', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string; authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success({
      settings: supabaseProfileService
        ? await supabaseProfileService.patchSettings(actor.authSubject, params.profileId, body)
        : await profileService.patchSettingsForAccount(actor.appUserId, params.profileId, body),
    }, request);
  });
}
