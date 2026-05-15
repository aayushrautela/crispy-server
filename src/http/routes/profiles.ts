import type { FastifyInstance } from 'fastify';
import { ProviderImportService, parseImportProvider } from '../../modules/integrations/provider-import.service.js';
import { mapProviderImportJobView } from '../../modules/integrations/provider-import.views.js';
import { SupabaseProfileService } from '../../modules/profiles/supabase-profile.service.js';
import { nonEmptyStringSchema, nullableStringSchema, profileIdParamsSchema, stringSchema, successEnvelope, withDefaultErrorResponses } from '../contracts/shared.js';
import { success, mutation } from '../response.js';

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
    },
  },
  response: {
    201: successEnvelope(providerImportResultSchema),
    202: successEnvelope(providerImportResultSchema),
  },
});

export async function registerProfileRoutes(
  app: FastifyInstance,
  opts: { supabaseProfileService: SupabaseProfileService },
): Promise<void> {
  const profileService = opts.supabaseProfileService;
  const providerImportService = new ProviderImportService();

  app.get('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    return success({
      profiles: await profileService.listForAccount(actor.authSubject),
    }, request);
  });

  app.post('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.create(actor.authSubject, {
      name: String(body.name ?? '').trim(),
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : null,
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
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : undefined,
      isKids: typeof body.isKids === 'boolean' ? body.isKids : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return success({ profile }, request);
  });

  app.post('/v1/profiles/:profileId/imports/start', { schema: providerImportStartRouteSchema }, async (request, reply) => {
    await app.requireAuth(request);
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
    const completed = await providerImportService.completeOAuthCallback(parseImportProvider(params.provider), {
      state: String(query.state ?? '').trim(),
      code: typeof query.code === 'string' ? query.code : undefined,
      error: typeof query.error === 'string' ? query.error : undefined,
      errorDescription:
        typeof query.error_description === 'string'
          ? query.error_description
          : typeof query.errorDescription === 'string'
            ? query.errorDescription
            : undefined,
    });
    reply.code(202);
    return mutation({
      ...completed,
      job: mapProviderImportJobView(completed.job),
    }, request);
  });
}
