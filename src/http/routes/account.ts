import type { FastifyInstance } from 'fastify';
import {
  accountSettingsPatchRouteSchema,
  accountSettingsRouteSchema,
  deleteResultRouteSchema,
  mdblistAccountSecretGetRouteSchema,
  mdblistAccountSecretPutRouteSchema,
} from '../contracts/account.js';
import { AccountDeletionService } from '../../modules/users/account-deletion.service.js';
import { FeatureEntitlementService } from '../../modules/entitlements/feature-entitlement.service.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';
import { success } from '../response.js';
import { createRequireAdminProfile, type AdminProfileLookup } from '../auth-helpers.js';
import { ProfileLocalService } from '../../modules/profiles/profile-local.service.js';

export async function registerAccountRoutes(
  app: FastifyInstance,
  opts: { accountSettingsService: AccountSettingsService; adminProfileLookup?: AdminProfileLookup },
): Promise<void> {
  const accountDeletionService = new AccountDeletionService();
  const accountSettingsService = opts.accountSettingsService;
  const requireAdminProfile = opts.adminProfileLookup
    ? createRequireAdminProfile(opts.adminProfileLookup)
    : createRequireAdminProfile(async (profileId, authSubject) => {
        const profileService = new ProfileLocalService();
        const profile = await profileService.requireOwnedProfile(authSubject, profileId);
        return { id: profile.id, accountId: authSubject, isAdmin: profile.isAdmin, hasPin: profile.hasPin };
      });
  const entitlementService = new FeatureEntitlementService();

  app.get('/v1/account/settings', { schema: accountSettingsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const baseSettings = await accountSettingsService.getSettings(actor.authSubject);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.authSubject);
    return success({
      settings: mergeAccountScopedSettings(baseSettings, {
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: await accountSettingsService.getPricingTierForUser(actor.authSubject),
      }),
    });
  });

  app.patch('/v1/account/settings', { schema: accountSettingsPatchRouteSchema }, async (request) => {
    await app.requireAuth(request);
    await requireAdminProfile(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const baseSettings = await accountSettingsService.patchSettings(actor.authSubject, body);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.authSubject);
    return success({
      settings: mergeAccountScopedSettings(baseSettings, {
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: await accountSettingsService.getPricingTierForUser(actor.authSubject),
      }),
    });
  });

  app.get('/v1/account/secrets/mdblist-api-key', { schema: mdblistAccountSecretGetRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    return success({
      secret: await accountSettingsService.getMdbListApiKeyMetadataForUser(actor.authSubject),
    });
  });

  app.put('/v1/account/secrets/mdblist-api-key', { schema: mdblistAccountSecretPutRouteSchema }, async (request) => {
    await app.requireAuth(request);
    await requireAdminProfile(request);
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success({
      secret: await accountSettingsService.setMdbListApiKeyForUser(actor.authSubject, String(body.value ?? '')),
    });
  });

  app.delete('/v1/account/secrets/mdblist-api-key', { schema: deleteResultRouteSchema }, async (request) => {
    await app.requireAuth(request);
    await requireAdminProfile(request);
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    return success({
      deleted: await accountSettingsService.clearMdbListApiKeyForUser(actor.authSubject),
    });
  });

  app.delete('/v1/account', { schema: deleteResultRouteSchema }, async (request) => {
    await app.requireAuth(request);
    await requireAdminProfile(request);
    const actor = app.requireUserSessionActor(request) as { appUserId: string; authSubject: string };
    return success({
      deleted: await accountDeletionService.deleteAccount({
        appUserId: actor.appUserId,
        authSubject: actor.authSubject,
      }),
    });
  });
}
