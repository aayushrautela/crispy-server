import type { FastifyInstance } from 'fastify';
import {
  accountSettingsPatchRouteSchema,
  accountSettingsRouteSchema,
  aiAccountSecretGetRouteSchema,
  aiAccountSecretPutRouteSchema,
  deleteResultRouteSchema,
} from '../contracts/account.js';
import { AccountDeletionService } from '../../modules/users/account-deletion.service.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  const accountDeletionService = new AccountDeletionService();
  const accountSettingsService = new AccountSettingsService();

  app.get('/v1/account/settings', { schema: accountSettingsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const baseSettings = await accountSettingsService.getSettings(actor.appUserId);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.appUserId);
    const hasOmdbApiKey = await accountSettingsService.getOmdbApiKeyForUser(actor.appUserId)
      .then(() => true)
      .catch(() => false);
    return {
      settings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasOmdbApiKey,
      }),
    };
  });

  app.patch('/v1/account/settings', { schema: accountSettingsPatchRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const baseSettings = await accountSettingsService.patchSettings(actor.appUserId, body);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.appUserId);
    const hasOmdbApiKey = await accountSettingsService.getOmdbApiKeyForUser(actor.appUserId)
      .then(() => true)
      .catch(() => false);
    return {
      settings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasOmdbApiKey,
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
