import type { FastifyInstance } from 'fastify';
import { meRouteSchema } from '../contracts/account.js';
import { FeatureEntitlementService } from '../../modules/entitlements/feature-entitlement.service.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';
import type { SupabaseProfileService } from '../../modules/profiles/supabase-profile.service.js';
import type { SupabaseAccountSettingsRepository } from '../../modules/users/supabase-account-settings.repo.js';
import { success } from '../response.js';

export async function registerMeRoutes(
  app: FastifyInstance,
  opts: { supabaseProfileService: SupabaseProfileService; supabaseAccountSettingsRepo: SupabaseAccountSettingsRepository },
): Promise<void> {
  const profileService = opts.supabaseProfileService;
  const accountSettingsService = new AccountSettingsService(opts.supabaseAccountSettingsRepo);
  const entitlementService = new FeatureEntitlementService();

  app.get('/v1/me', { schema: meRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const baseSettings = await accountSettingsService.getSettings(actor.authSubject);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.authSubject);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.authSubject);
    const auth = request.auth!;
    const profiles = await profileService.listForAccount(actor.authSubject);
    return success({
      user: {
        id: actor.authSubject,
        email: auth.email,
      },
      accountSettings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: await accountSettingsService.getPricingTierForUser(actor.authSubject),
      }),
      profiles,
    });
  });
}
