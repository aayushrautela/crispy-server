import type { FastifyInstance } from 'fastify';
import { meRouteSchema } from '../contracts/account.js';
import { FeatureEntitlementService } from '../../modules/entitlements/feature-entitlement.service.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import type { SupabaseProfileService } from '../../modules/profiles/supabase-profile.service.js';
import type { SupabaseAccountSettingsRepository } from '../../modules/users/supabase-account-settings.repo.js';
import { mapProfileView } from '../../modules/profiles/profile.views.js';
import { success } from '../response.js';

export async function registerMeRoutes(
  app: FastifyInstance,
  opts?: { supabaseProfileService?: SupabaseProfileService; supabaseAccountSettingsRepo?: SupabaseAccountSettingsRepository },
): Promise<void> {
  const profileService = new ProfileService();
  const supabaseProfileService = opts?.supabaseProfileService;
  const accountSettingsService = opts?.supabaseAccountSettingsRepo
    ? new AccountSettingsService(opts.supabaseAccountSettingsRepo)
    : new AccountSettingsService();
  const entitlementService = new FeatureEntitlementService();

  app.get('/v1/me', { schema: meRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string; authSubject: string };
    const baseSettings = await accountSettingsService.getSettings(actor.appUserId);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.appUserId);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.appUserId);
    const auth = request.auth!;
    const profiles = supabaseProfileService
      ? await supabaseProfileService.listForAccount(actor.authSubject)
      : (await profileService.listForAccount(actor.appUserId)).map((p) => mapProfileView(p));
    return success({
      user: {
        id: supabaseProfileService ? actor.authSubject : actor.appUserId,
        email: auth.email,
      },
      accountSettings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: await accountSettingsService.getPricingTierForUser(actor.appUserId),
      }),
      profiles,
    });
  });
}
