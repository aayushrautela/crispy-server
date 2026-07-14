import type { FastifyInstance } from 'fastify';
import { AccountDeletionService } from '../../modules/users/account-deletion.service.js';
import { AccountSettingsService, mergeAccountScopedSettings } from '../../modules/users/account-settings.service.js';
import { FeatureEntitlementService } from '../../modules/entitlements/feature-entitlement.service.js';
import { ProviderImportService, parseImportProvider } from '../../modules/integrations/provider-import.service.js';
import { mapProviderImportJobView } from '../../modules/integrations/provider-import.views.js';
import type { PersonalAccessTokenService } from '../../modules/auth/personal-access-token.service.js';
import type { AuthScope } from '../../modules/auth/auth.types.js';
import { isPersonalAccessTokenScope } from '../../modules/auth/auth.types.js';
import type { ProfileLocalService } from '../../modules/profiles/profile-local.service.js';
import { success, mutation } from '../response.js';
import {
  portalMeRouteSchema,
  portalProfilesListRouteSchema,
  portalProfileCreateRouteSchema,
  portalProfileUpdateRouteSchema,
  portalApiKeysListRouteSchema,
  portalApiKeyCreateRouteSchema,
  portalApiKeyRevokeRouteSchema,
  portalProviderConnectionsRouteSchema,
  portalProviderConnectionsDeleteRouteSchema,
  portalImportStartRouteSchema,
  portalImportsListRouteSchema,
  portalImportJobGetRouteSchema,
  portalProfileSettingsGetRouteSchema,
  portalProfileSettingsPatchRouteSchema,
} from '../contracts/portal.js';

export async function registerPortalRoutes(
  app: FastifyInstance,
  opts: {
    profileService: ProfileLocalService;
    accountSettingsService: AccountSettingsService;
    patService: PersonalAccessTokenService;
  },
): Promise<void> {
  const { profileService, accountSettingsService, patService } = opts;
  const providerImportService = new ProviderImportService();
  const accountDeletionService = new AccountDeletionService();
  const entitlementService = new FeatureEntitlementService();

  const auth = async (req: import('fastify').FastifyRequest) => app.portalOptionalUserAuth(req);
  const mutationAuth = async (req: import('fastify').FastifyRequest) => {
    await app.portalOptionalUserAuth(req);
    app.portalRequireUserMutation(req);
  };

  // ---- Me ----

  app.get('/v1/portal/me', { schema: portalMeRouteSchema, preHandler: [auth] }, async (request) => {
    const actor = app.requireUserActor(request) as { authSubject: string };
    const baseSettings = await accountSettingsService.getSettings(actor.authSubject);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.authSubject);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.authSubject);
    const profiles = await profileService.listForAccount(actor.authSubject);
    return success({
      user: {
        id: actor.authSubject,
        email: request.auth!.email,
      },
      accountSettings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: await accountSettingsService.getPricingTierForUser(actor.authSubject),
      }),
      profiles,
    }, request);
  });

  // ---- Profiles ----

  app.get('/v1/portal/profiles', { schema: portalProfilesListRouteSchema, preHandler: [auth] }, async (request) => {
    const actor = app.requireUserActor(request) as { authSubject: string };
    return success({
      profiles: await profileService.listForAccount(actor.authSubject),
    }, request);
  });

  app.post('/v1/portal/profiles', { schema: portalProfileCreateRouteSchema, preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.create(actor.authSubject, {
      name: String(body.name ?? '').trim(),
      interfaceLanguage: typeof body.interfaceLanguage === 'string' ? body.interfaceLanguage : '',
      region: body.region === null || typeof body.region === 'string' ? body.region : undefined,
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : null,
      isKids: Boolean(body.isKids),
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return success({ profile }, request);
  });

  app.patch('/v1/portal/profiles/:profileId', { schema: portalProfileUpdateRouteSchema, preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.update(actor.authSubject, params.profileId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      interfaceLanguage: typeof body.interfaceLanguage === 'string' ? body.interfaceLanguage : undefined,
      region: body.region === null || typeof body.region === 'string' ? body.region : undefined,
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : undefined,
      isKids: typeof body.isKids === 'boolean' ? body.isKids : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return success({ profile }, request);
  });

  app.get('/v1/portal/profiles/:profileId/settings', { schema: portalProfileSettingsGetRouteSchema, preHandler: [auth] }, async (request) => {
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    return success({
      settings: await profileService.getSettings(actor.authSubject, params.profileId),
    }, request);
  });

  app.patch('/v1/portal/profiles/:profileId/settings', { schema: portalProfileSettingsPatchRouteSchema, preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success({
      settings: await profileService.patchSettings(actor.authSubject, params.profileId, body),
    }, request);
  });

  // ---- Provider Imports ----

  app.get('/v1/portal/profiles/:profileId/import-connections', { schema: portalProviderConnectionsRouteSchema, preHandler: [auth] }, async (request) => {
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    return success(await providerImportService.listProviderSessions(actor.appUserId, params.profileId), request);
  });

  app.post('/v1/portal/profiles/:profileId/imports/start', { schema: portalImportStartRouteSchema, preHandler: [mutationAuth] }, async (request, reply) => {
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const provider = parseImportProvider(body.provider);
    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : 'import';
    const started = action === 'connect'
      ? await providerImportService.connectProvider(actor.appUserId, params.profileId, provider)
      : action === 'reconnect'
        ? await providerImportService.reconnectProvider(actor.appUserId, params.profileId, provider)
        : await providerImportService.importProviderNow(actor.appUserId, params.profileId, provider);
    reply.code(started.nextAction === 'queued' ? 202 : 201);
    return mutation({
      ...started,
      job: started.job ? mapProviderImportJobView(started.job) : null,
    }, request);
  });

  app.get('/v1/portal/profiles/:profileId/imports', { schema: portalImportsListRouteSchema, preHandler: [auth] }, async (request) => {
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    const result = await providerImportService.listJobs(actor.appUserId, params.profileId);
    return success({
      ...result,
      jobs: result.jobs.map((job) => mapProviderImportJobView(job)),
    }, request);
  });

  app.get('/v1/portal/profiles/:profileId/imports/:jobId', { schema: portalImportJobGetRouteSchema, preHandler: [auth] }, async (request) => {
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string; jobId: string };
    const job = await providerImportService.getJob(actor.appUserId, params.profileId, params.jobId);
    return success({ job: mapProviderImportJobView(job) }, request);
  });

  app.delete('/v1/portal/profiles/:profileId/import-connections/:provider', { schema: portalProviderConnectionsDeleteRouteSchema, preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string; provider: string };
    return success(await providerImportService.disconnectProviderSession(actor.appUserId, params.profileId, parseImportProvider(params.provider)), request);
  });

  // ---- Account Settings ----

  app.get('/v1/portal/account/settings', { preHandler: [auth] }, async (request) => {
    const actor = app.requireUserActor(request) as { authSubject: string };
    const baseSettings = await accountSettingsService.getSettings(actor.authSubject);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.authSubject);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.authSubject);
    return success({
      settings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: await accountSettingsService.getPricingTierForUser(actor.authSubject),
      }),
    });
  });

  app.patch('/v1/portal/account/settings', { preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const baseSettings = await accountSettingsService.patchSettings(actor.authSubject, body);
    const ai = await accountSettingsService.getAiClientSettingsForUser(actor.authSubject);
    const metadata = await entitlementService.getMetadataClientSettingsForUser(actor.authSubject);
    return success({
      settings: mergeAccountScopedSettings(baseSettings, {
        ai,
        hasMdbListAccess: metadata.hasMdbListAccess,
        pricingTier: await accountSettingsService.getPricingTierForUser(actor.authSubject),
      }),
    });
  });

  // ---- Secrets ----

  app.get('/v1/portal/account/secrets/ai-api-key', { preHandler: [auth] }, async (request) => {
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    return success({
      secret: await accountSettingsService.getAiApiKeyMetadataForUser(actor.authSubject),
    });
  });

  app.put('/v1/portal/account/secrets/ai-api-key', { preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success({
      secret: await accountSettingsService.setAiApiKeyForUser(actor.authSubject, String(body.value ?? '')),
    });
  });

  app.delete('/v1/portal/account/secrets/ai-api-key', { preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    return success({
      deleted: await accountSettingsService.clearAiApiKeyForUser(actor.authSubject),
    });
  });

  app.get('/v1/portal/account/secrets/mdblist-api-key', { preHandler: [auth] }, async (request) => {
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    return success({
      secret: await accountSettingsService.getMdbListApiKeyMetadataForUser(actor.authSubject),
    });
  });

  app.put('/v1/portal/account/secrets/mdblist-api-key', { preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success({
      secret: await accountSettingsService.setMdbListApiKeyForUser(actor.authSubject, String(body.value ?? '')),
    });
  });

  app.delete('/v1/portal/account/secrets/mdblist-api-key', { preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    return success({
      deleted: await accountSettingsService.clearMdbListApiKeyForUser(actor.authSubject),
    });
  });

  // ---- Delete Account ----

  app.delete('/v1/portal/account', { preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserSessionActor(request) as { appUserId: string; authSubject: string };
    return success({
      deleted: await accountDeletionService.deleteAccount({
        appUserId: actor.appUserId,
        authSubject: actor.authSubject,
      }),
    });
  });

  // ---- Personal Access Tokens (API Keys) ----

  app.get('/v1/portal/api-keys', { schema: portalApiKeysListRouteSchema, preHandler: [auth] }, async (request) => {
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    return success({
      items: await patService.listForUser(actor.authSubject),
    }, request);
  });

  app.post('/v1/portal/api-keys', { schema: portalApiKeyCreateRouteSchema, preHandler: [mutationAuth] }, async (request, reply) => {
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const created = await patService.createForUser(actor.authSubject, {
      name: String(body.name ?? '').trim(),
      scopes: parseScopes(body.scopes),
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    });
    reply.code(201);
    return mutation({ token: created }, request);
  });

  app.delete('/v1/portal/api-keys/:tokenId', { schema: portalApiKeyRevokeRouteSchema, preHandler: [mutationAuth] }, async (request) => {
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    const params = request.params as { tokenId: string };
    return success({
      token: await patService.revokeForUser(actor.authSubject, params.tokenId),
    }, request);
  });
}

function parseScopes(value: unknown): AuthScope[] | undefined {
  return Array.isArray(value) ? value.filter(isPersonalAccessTokenScope) : undefined;
}
