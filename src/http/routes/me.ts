import type { FastifyInstance } from 'fastify';
import { withTransaction } from '../../lib/db.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';
import { HouseholdService } from '../../modules/households/household.service.js';
import { ProfileRepository } from '../../modules/profiles/profile.repo.js';

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  const householdService = new HouseholdService();
  const profileRepository = new ProfileRepository();
  const accountSettingsService = new AccountSettingsService();

  app.get('/v1/me', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const baseSettings = await accountSettingsService.getSettings(actor.appUserId);
    const hasOpenRouterKey = await accountSettingsService.getOpenRouterKeyForUser(actor.appUserId)
      .then(() => true)
      .catch(() => false);
    const hasOmdbApiKey = await accountSettingsService.getOmdbApiKeyForUser(actor.appUserId)
      .then(() => true)
      .catch(() => false);
    return withTransaction(async (client) => {
      const auth = request.auth!;
      const householdId = await householdService.ensureDefaultHousehold(client, { userId: actor.appUserId });
      const profiles = await profileRepository.listForHousehold(client, householdId);
      return {
        user: {
          id: actor.appUserId,
          email: auth.email,
        },
        household: {
          id: householdId,
        },
        accountSettings: mergeAccountScopedSettings(baseSettings, {
          hasOpenRouterKey,
          hasOmdbApiKey,
        }),
        profiles,
      };
    });
  });
}
