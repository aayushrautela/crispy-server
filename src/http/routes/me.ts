import type { FastifyInstance } from 'fastify';
import { meRouteSchema } from '../contracts/account.js';
import { FeatureEntitlementService } from '../../modules/entitlements/feature-entitlement.service.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';
import type { ProfileLocalService } from '../../modules/profiles/profile-local.service.js';
import { success } from '../response.js';

export async function registerMeRoutes(
  app: FastifyInstance,
  opts: { profileService: ProfileLocalService; accountSettingsService: AccountSettingsService },
): Promise<void> {
  const profileService = opts.profileService;
  const accountSettingsService = opts.accountSettingsService;
  const entitlementService = new FeatureEntitlementService();

  app.get('/v1/me', { schema: meRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const baseSettings = await accountSettingsService.getSettings(actor.authSubject);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.authSubject);
    const auth = request.auth!;
    const profiles = await profileService.listForAccount(actor.authSubject);
    return success({
      user: {
        id: actor.authSubject,
        email: auth.email,
      },
      accountSettings: mergeAccountScopedSettings(baseSettings, {
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: await accountSettingsService.getPricingTierForUser(actor.authSubject),
      }),
      profiles,
    });
  });
}
