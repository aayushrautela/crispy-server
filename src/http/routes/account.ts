import type { FastifyInstance } from 'fastify';
import {
  accountSettingsPatchRouteSchema,
  accountSettingsRouteSchema,
  aiAccountSecretGetRouteSchema,
  aiAccountSecretPutRouteSchema,
  deleteResultRouteSchema,
  mdblistAccountSecretGetRouteSchema,
  mdblistAccountSecretPutRouteSchema,
} from '../contracts/account.js';
import { AccountDeletionService } from '../../modules/users/account-deletion.service.js';
import { FeatureEntitlementService } from '../../modules/entitlements/feature-entitlement.service.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  const accountDeletionService = new AccountDeletionService();
  const accountSettingsService = new AccountSettingsService();
  const entitlementService = new FeatureEntitlementService();

  app.get('/v1/account/settings', { schema: accountSettingsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const baseSettings = await accountSettingsService.getSettings(actor.appUserId);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.appUserId);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.appUserId);
    return {
      settings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: accountSettingsService.getPricingTierForUser(actor.appUserId),
      }),
    };
  });

  app.patch('/v1/account/settings', { schema: accountSettingsPatchRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const baseSettings = await accountSettingsService.patchSettings(actor.appUserId, body);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.appUserId);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.appUserId);
    return {
      settings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: accountSettingsService.getPricingTierForUser(actor.appUserId),
      }),
    };
  });

  app.get('/v1/account/secrets/ai-api-key', { schema: aiAccountSecretGetRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      secret: await accountSettingsService.getAiApiKeyForUser(actor.appUserId),
    };
  });

  app.put('/v1/account/secrets/ai-api-key', { schema: aiAccountSecretPutRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return {
      secret: await accountSettingsService.setAiApiKeyForUser(actor.appUserId, String(body.value ?? '')),
    };
  });

  app.delete('/v1/account/secrets/ai-api-key', { schema: deleteResultRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      deleted: await accountSettingsService.clearAiApiKeyForUser(actor.appUserId),
    };
  });

  app.get('/v1/account/secrets/mdblist-api-key', { schema: mdblistAccountSecretGetRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      secret: await accountSettingsService.getMdbListApiKeyForUser(actor.appUserId),
    };
  });

  app.put('/v1/account/secrets/mdblist-api-key', { schema: mdblistAccountSecretPutRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return {
      secret: await accountSettingsService.setMdbListApiKeyForUser(actor.appUserId, String(body.value ?? '')),
    };
  });

  app.delete('/v1/account/secrets/mdblist-api-key', { schema: deleteResultRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      deleted: await accountSettingsService.clearMdbListApiKeyForUser(actor.appUserId),
    };
  });

  app.delete('/v1/account', { schema: deleteResultRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      deleted: await accountDeletionService.deleteAccount({
        appUserId: actor.appUserId,
        authSubject: actor.authSubject,
      }),
    };
  });
}
