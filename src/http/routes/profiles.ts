import type { FastifyInstance } from 'fastify';
import { ProviderImportService, parseImportProvider } from '../../modules/integrations/provider-import.service.js';
import { mapProviderImportJobView } from '../../modules/integrations/provider-import.views.js';
import {
  IMPORT_CLIENT_IDS,
  validateImportReturnTo,
  buildImportReturnUrl,
  type ValidatedImportReturnTo,
} from '../../modules/integrations/provider-import-return-to.js';
import type { ProfileLocalService } from '../../modules/profiles/profile-local.service.js';
import { ProfilePinService } from '../../modules/profiles/profile-pin.service.js';
import { SUPPORTED_LANGUAGES } from '../../modules/i18n/supported-languages.js';
import { SUPPORTED_COUNTRIES } from '../../modules/i18n/supported-countries.js';
import { nonEmptyStringSchema, nullableStringSchema, profileIdParamsSchema, stringSchema, successEnvelope, withDefaultErrorResponses } from '../contracts/shared.js';
import { success, mutation } from '../response.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { createRequireAdminProfile, type AdminProfileLookup } from '../auth-helpers.js';

function safeParseReturnTo(stored: string): ValidatedImportReturnTo | null {
  // The stored value was validated at /imports/start time, but we still parse
  // defensively in case of manual DB tampering. Returns null on any anomaly.
  const parts = stored.split('|', 2);
  if (parts.length !== 2) return null;
  const [clientId, baseUrl] = parts;
  if (!IMPORT_CLIENT_IDS.includes(clientId as typeof IMPORT_CLIENT_IDS[number])) return null;
  try {
    // Re-validate using the same allowlist so we don't trust raw DB contents.
    return validateImportReturnTo(clientId, baseUrl);
  } catch {
    return null;
  }
}

const providerStateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'provider',
    'connectionState',
    'accountStatus',
    'primaryAction',
    'canImport',
    'canReconnect',
    'canDisconnect',
    'externalUsername',
    'statusLabel',
    'statusMessage',
    'lastImportCompletedAt',
  ],
  properties: {
    provider: { type: 'string', enum: ['trakt', 'simkl'] },
    connectionState: { type: 'string', enum: ['not_connected', 'pending_authorization', 'connected', 'reauthorization_required'] },
    accountStatus: { anyOf: [{ type: 'string', enum: ['pending', 'connected', 'expired', 'revoked'] }, { type: 'null' }] },
    primaryAction: { type: 'string', enum: ['connect', 'import', 'reconnect'] },
    canImport: { type: 'boolean' },
    canReconnect: { type: 'boolean' },
    canDisconnect: { type: 'boolean' },
    externalUsername: nullableStringSchema,
    statusLabel: stringSchema,
    statusMessage: nullableStringSchema,
    lastImportCompletedAt: nullableStringSchema,
  },
} as const;

const providerConnectionsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['providerStates', 'watchDataState'],
  properties: {
    providerStates: {
      type: 'array',
      items: providerStateSchema,
    },
    watchDataState: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['profileId', 'watchDataUpdatedAt', 'watchDataOrigin', 'lastImportCompletedAt'],
          properties: {
            profileId: stringSchema,
            watchDataUpdatedAt: stringSchema,
            watchDataOrigin: { type: 'string', enum: ['native', 'provider_import'] },
            lastImportCompletedAt: { anyOf: [stringSchema, { type: 'null' }] },
          },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

const providerConnectionRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: successEnvelope(providerConnectionsResponseSchema),
  },
});

const providerConnectionDeleteResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['providerState'],
  properties: {
    providerState: providerStateSchema,
  },
} as const;

const providerConnectionDeleteRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['profileId', 'provider'],
    properties: {
      profileId: profileIdParamsSchema.properties.profileId,
      provider: nonEmptyStringSchema,
    },
  },
  body: { type: 'object', additionalProperties: false },
  response: {
    200: successEnvelope(providerConnectionDeleteResponseSchema),
  },
});

const providerImportResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['job', 'providerState', 'watchDataState', 'authUrl', 'nextAction'],
  properties: {
    job: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    providerState: providerStateSchema,
    watchDataState: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['profileId', 'watchDataUpdatedAt', 'watchDataOrigin', 'lastImportCompletedAt'],
          properties: {
            profileId: stringSchema,
            watchDataUpdatedAt: stringSchema,
            watchDataOrigin: { type: 'string', enum: ['native', 'provider_import'] },
            lastImportCompletedAt: nullableStringSchema,
          },
        },
        { type: 'null' },
      ],
    },
    authUrl: nullableStringSchema,
    nextAction: { type: 'string', enum: ['authorize_provider', 'queued'] },
  },
} as const;

const providerImportStartRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['provider', 'action'],
    properties: {
      provider: { type: 'string', enum: ['trakt', 'simkl'] },
      action: { type: 'string', enum: ['connect', 'reconnect', 'import'] },
      clientId: { type: 'string', enum: ['crispy-web', 'crispy-ios', 'crispy-android', 'crispy-desktop'] },
      returnTo: { type: 'string', maxLength: 2048 },
    },
  },
  response: {
    201: successEnvelope(providerImportResultSchema),
    202: successEnvelope(providerImportResultSchema),
  },
});

export async function registerProfileRoutes(
  app: FastifyInstance,
  opts: { profileService: ProfileLocalService; pinService?: ProfilePinService; adminProfileLookup?: AdminProfileLookup },
): Promise<void> {
  const profileService = opts.profileService;
  const pinService = opts.pinService ?? new ProfilePinService();
  const providerImportService = new ProviderImportService();
  const requireAdminProfile = opts.adminProfileLookup
    ? createRequireAdminProfile(opts.adminProfileLookup)
    : createRequireAdminProfile(async (profileId, authSubject) => {
        const profile = await profileService.requireOwnedProfile(authSubject, profileId);
        return { id: profile.id, accountId: authSubject, isAdmin: profile.isAdmin, hasPin: profile.hasPin };
      });

  app.get('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    return success({
      profiles: await profileService.listForAccount(actor.authSubject),
    }, request);
  });

  app.get('/v1/i18n/languages', async (request) => {
    await app.requireAuth(request);
    return success({ languages: SUPPORTED_LANGUAGES }, request);
  });

  app.get('/v1/i18n/countries', async (request) => {
    await app.requireAuth(request);
    return success({ countries: SUPPORTED_COUNTRIES }, request);
  });

  app.post('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    await requireAdminProfile(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const adminPin = body.adminPin;
    if (typeof adminPin === 'string') {
      await pinService.verifyAdminPinForAddProfile(actor.authSubject, adminPin);
    }
    const profile = await profileService.create(actor.authSubject, {
      name: String(body.name ?? '').trim(),
      interfaceLanguage: typeof body.interfaceLanguage === 'string' ? body.interfaceLanguage : '',
      region: body.region === null || typeof body.region === 'string' ? body.region : undefined,
      avatarUrl: typeof body.avatarUrl === 'string' ? body.avatarUrl : null,
      isKids: Boolean(body.isKids),
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return success({ profile }, request);
  });

  app.patch('/v1/profiles/:profileId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.update(actor.authSubject, params.profileId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      interfaceLanguage: typeof body.interfaceLanguage === 'string' ? body.interfaceLanguage : undefined,
      region: body.region === null || typeof body.region === 'string' ? body.region : undefined,
      avatarUrl: typeof body.avatarUrl === 'string' ? body.avatarUrl : undefined,
      isKids: typeof body.isKids === 'boolean' ? body.isKids : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return success({ profile }, request);
  });

  app.delete('/v1/profiles/:profileId', async (request) => {
    await app.requireAuth(request);
    await requireAdminProfile(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const adminPin = body.adminPin;
    if (typeof adminPin === 'string') {
      await pinService.verifyAdminPinForAddProfile(actor.authSubject, adminPin);
    }
    await profileService.delete(actor.authSubject, params.profileId);
    return success({ deleted: true }, request);
  });

  app.post('/v1/profiles/:profileId/pin', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    await pinService.setPin(actor.authSubject, params.profileId, body.pin);
    return success({ ok: true }, request);
  });

  app.patch('/v1/profiles/:profileId/pin', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    await pinService.changePin(actor.authSubject, params.profileId, body.currentPin, body.newPin);
    return success({ ok: true }, request);
  });

  app.delete('/v1/profiles/:profileId/pin', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    await pinService.removePin(actor.authSubject, params.profileId, body.currentPin);
    return success({ ok: true }, request);
  });

  app.post('/v1/profiles/:profileId/pin/verify', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await pinService.verifyPin(params.profileId, actor.authSubject, body.pin);
    return success({ verify: result }, request);
  });

  app.post('/v1/profiles/:profileId/lock', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    await pinService.lock(actor.authSubject, params.profileId);
    return success({ ok: true }, request);
  });

  app.patch('/v1/profiles/:profileId/admin-policy', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.requireOwnedProfile(actor.authSubject, params.profileId);
    if (!profile.isAdmin) {
      throw Object.assign(new Error('Admin profile required.'), { statusCode: 403 });
    }
    const value = Boolean(body.requirePinToAddProfiles);
    await pinService.setRequirePinToAddProfiles(actor.authSubject, params.profileId, value);
    return success({ ok: true }, request);
  });

  app.post('/v1/profiles/:profileId/imports/start', { schema: providerImportStartRouteSchema }, async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const provider = parseImportProvider(body.provider);
    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : 'import';

    let importClient: ValidatedImportReturnTo | null = null;
    if (action === 'connect' || action === 'reconnect') {
      importClient = validateImportReturnTo(String(body.clientId ?? ''), String(body.returnTo ?? ''));
    }

    const started = action === 'connect'
      ? await providerImportService.connectProvider(actor.appUserId, params.profileId, provider, importClient ?? undefined)
      : action === 'reconnect'
        ? await providerImportService.reconnectProvider(actor.appUserId, params.profileId, provider, importClient ?? undefined)
        : await providerImportService.importProviderNow(actor.appUserId, params.profileId, provider);
    reply.code(started.nextAction === 'queued' ? 202 : 201);
    return mutation({
      ...started,
      job: started.job ? mapProviderImportJobView(started.job) : null,
    }, request);
  });

  app.get('/v1/profiles/:profileId/imports', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    const result = await providerImportService.listJobs(actor.appUserId, params.profileId);
    return success({
      ...result,
      jobs: result.jobs.map((job) => mapProviderImportJobView(job)),
    }, request);
  });

  app.get('/v1/profiles/:profileId/import-connections', { schema: providerConnectionRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    return success(await providerImportService.listProviderSessions(actor.appUserId, params.profileId), request);
  });

  app.delete('/v1/profiles/:profileId/import-connections/:provider', { schema: providerConnectionDeleteRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string; provider: string };
    return success(await providerImportService.disconnectProviderSession(actor.appUserId, params.profileId, parseImportProvider(params.provider)), request);
  });

  app.get('/v1/profiles/:profileId/imports/:jobId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string; jobId: string };
    const job = await providerImportService.getJob(actor.appUserId, params.profileId, params.jobId);
    return success({ job: mapProviderImportJobView(job) }, request);
  });

  app.get('/v1/imports/:provider/callback', async (request, reply) => {
    const params = request.params as { provider: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    const provider = parseImportProvider(params.provider);

    // Look up the pending session first so we know where to send the browser
    // back to, regardless of whether the exchange succeeds or fails.
    const state = String(query.state ?? '').trim();
    const pendingSession = await providerImportService.findPendingOAuthSession(provider, state);

    // Use the stored return-to if we have it; otherwise fall back to the web app,
    // so a broken/unknown callback still lands somewhere user-visible.
    const fallbackReturnTo: ValidatedImportReturnTo = { clientId: 'crispy-web', baseUrl: env.appPublicUrl };
    const returnTo = pendingSession?.oauthReturnTo
      ? safeParseReturnTo(pendingSession.oauthReturnTo) ?? fallbackReturnTo
      : fallbackReturnTo;

    try {
      const completed = await providerImportService.completeOAuthCallback(provider, {
        state,
        code: typeof query.code === 'string' ? query.code : undefined,
        error: typeof query.error === 'string' ? query.error : undefined,
        errorDescription:
          typeof query.error_description === 'string'
            ? query.error_description
            : typeof query.errorDescription === 'string'
              ? query.errorDescription
              : undefined,
      });
      // Success → redirect to the client with status=ok. The client re-fetches
      // provider state via its own authenticated API; no tokens on the URL.
      const successUrl = buildImportReturnUrl(returnTo, {
        provider,
        status: 'ok',
        profileId: completed.job.profileId,
      });
      return reply.redirect(successUrl, 302);
    } catch (err) {
      const httpStatus = err instanceof HttpError ? err.statusCode : 500;
      const errorCode = err instanceof HttpError && err.code ? err.code : 'provider_callback_failed';
      reply.status(httpStatus);
      // Failures also go back to the client — they render their own error UI.
      const errorUrl = buildImportReturnUrl(returnTo, {
        provider,
        status: 'error',
        profileId: pendingSession?.profileId ?? '',
        errorCode,
      });
      return reply.redirect(errorUrl, 302);
    }
  });
}
