import type { FastifyInstance } from 'fastify';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import { mapProfileView } from '../../modules/profiles/profile.views.js';

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  const profileService = new ProfileService();
  const accountSettingsService = new AccountSettingsService();

  app.get('/v1/me', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const baseSettings = await accountSettingsService.getSettings(actor.appUserId);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.appUserId);
    const hasOmdbApiKey = await accountSettingsService.getOmdbApiKeyForUser(actor.appUserId)
      .then(() => true)
      .catch(() => false);
    const auth = request.auth!;
    const profiles = await profileService.listForAccount(actor.appUserId);
    return {
      user: {
        id: actor.appUserId,
        email: auth.email,
      },
      accountSettings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasOmdbApiKey,
      }),
      profiles: profiles.map((profile) => mapProfileView(profile)),
    };
  });
}
