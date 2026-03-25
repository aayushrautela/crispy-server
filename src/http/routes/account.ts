import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { AccountDeletionService } from '../../modules/users/account-deletion.service.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  const accountDeletionService = new AccountDeletionService();
  const accountSettingsService = new AccountSettingsService();

  app.get('/v1/account/settings', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const baseSettings = await accountSettingsService.getSettings(actor.appUserId);
    const hasAiApiKey = await accountSettingsService.getAiApiKeyForUser(actor.appUserId)
      .then(() => true)
      .catch(() => false);
    const hasOmdbApiKey = await accountSettingsService.getOmdbApiKeyForUser(actor.appUserId)
      .then(() => true)
      .catch(() => false);
    return {
      settings: mergeAccountScopedSettings(baseSettings, {
        hasOpenRouterKey: hasAiApiKey,
        hasAiApiKey,
        hasOmdbApiKey,
        aiEndpointUrl: env.aiEndpointUrl,
      }),
    };
  });

  app.patch('/v1/account/settings', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return {
      settings: await accountSettingsService.patchSettings(actor.appUserId, body),
    };
  });

  app.get('/v1/account/secrets/ai-api-key', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      secret: await accountSettingsService.getAiApiKeyForUser(actor.appUserId),
    };
  });

  app.put('/v1/account/secrets/ai-api-key', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return {
      secret: await accountSettingsService.setAiApiKeyForUser(actor.appUserId, String(body.value ?? '')),
    };
  });

  app.delete('/v1/account/secrets/ai-api-key', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      deleted: await accountSettingsService.clearAiApiKeyForUser(actor.appUserId),
    };
  });

  app.get('/v1/account/secrets/openrouter-key', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      secret: await accountSettingsService.getAiApiKeyForUser(actor.appUserId),
    };
  });

  app.put('/v1/account/secrets/openrouter-key', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return {
      secret: await accountSettingsService.setAiApiKeyForUser(actor.appUserId, String(body.value ?? '')),
    };
  });

  app.delete('/v1/account/secrets/openrouter-key', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      deleted: await accountSettingsService.clearAiApiKeyForUser(actor.appUserId),
    };
  });

  app.get('/v1/account/secrets/omdb-api-key', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      secret: await accountSettingsService.getOmdbApiKeyForUser(actor.appUserId),
    };
  });

  app.put('/v1/account/secrets/omdb-api-key', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return {
      secret: await accountSettingsService.setOmdbApiKeyForUser(actor.appUserId, String(body.value ?? '')),
    };
  });

  app.delete('/v1/account/secrets/omdb-api-key', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      deleted: await accountSettingsService.clearOmdbApiKeyForUser(actor.appUserId),
    };
  });

  app.delete('/v1/account', async (request) => {
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
