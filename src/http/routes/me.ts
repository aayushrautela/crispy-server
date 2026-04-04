import type { FastifyInstance } from 'fastify';
import { meRouteSchema } from '../contracts/account.js';
import { FeatureEntitlementService } from '../../modules/entitlements/feature-entitlement.service.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import { mapProfileView } from '../../modules/profiles/profile.views.js';

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  const profileService = new ProfileService();
  const accountSettingsService = new AccountSettingsService();
  const entitlementService = new FeatureEntitlementService();

  app.get('/v1/me', { schema: meRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const baseSettings = await accountSettingsService.getSettings(actor.appUserId);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.appUserId);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.appUserId);
    const auth = request.auth!;
    const profiles = await profileService.listForAccount(actor.appUserId);
    return {
      user: {
        id: actor.appUserId,
        email: auth.email,
      },
      accountSettings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: accountSettingsService.getPricingTierForUser(actor.appUserId),
      }),
      profiles: profiles.map((profile) => mapProfileView(profile)),
    };
  });
}
