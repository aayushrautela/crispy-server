import type { FastifyInstance } from 'fastify';
import { ProviderImportService, parseImportProvider } from '../../modules/integrations/provider-import.service.js';
import { mapProviderImportJobView } from '../../modules/integrations/provider-import.views.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import { mapProfileView } from '../../modules/profiles/profile.views.js';
import { nonEmptyStringSchema, nullableStringSchema, profileIdParamsSchema, stringSchema, withDefaultErrorResponses } from '../contracts/shared.js';

const providerStateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'provider',
    'providerAccountId',
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
    providerAccountId: nullableStringSchema,
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

const providerConnectionRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: {
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
    },
  },
});

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
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['providerState'],
      properties: {
        providerState: providerStateSchema,
      },
    },
  },
});

const providerImportStartRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['provider'],
    properties: {
      provider: { type: 'string', enum: ['trakt', 'simkl'] },
    },
  },
  response: {
    201: {
      type: 'object',
      additionalProperties: false,
      required: ['job', 'providerState', 'watchDataState', 'authUrl', 'nextAction', 'providerAccount'],
      properties: {
        job: { type: 'object', additionalProperties: true },
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
        providerAccount: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
      },
    },
    202: {
      type: 'object',
      additionalProperties: false,
      required: ['job', 'providerState', 'watchDataState', 'authUrl', 'nextAction', 'providerAccount'],
      properties: {
        job: { type: 'object', additionalProperties: true },
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
        providerAccount: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
      },
    },
  },
});

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  const profileService = new ProfileService();
  const providerImportService = new ProviderImportService();

  app.get('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    return {
      profiles: (await profileService.listForAccount(actor.appUserId)).map((profile) => mapProfileView(profile)),
    };
  });

  app.post('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.create(actor.appUserId, {
      name: String(body.name ?? '').trim(),
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : null,
      isKids: Boolean(body.isKids),
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return { profile: mapProfileView(profile) };
  });

  app.patch('/v1/profiles/:profileId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.update(actor.appUserId, params.profileId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : undefined,
      isKids: typeof body.isKids === 'boolean' ? body.isKids : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return { profile: mapProfileView(profile) };
  });

  app.post('/v1/profiles/:profileId/imports/start', { schema: providerImportStartRouteSchema }, async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const started = await providerImportService.startReplaceImport(
      actor.appUserId,
      params.profileId,
      parseImportProvider(body.provider),
    );
    reply.code(started.nextAction === 'queued' ? 202 : 201);
    return {
      ...started,
      job: mapProviderImportJobView(started.job),
    };
  });

  app.get('/v1/profiles/:profileId/imports', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    const result = await providerImportService.listJobs(actor.appUserId, params.profileId);
    return {
      ...result,
      jobs: result.jobs.map((job) => mapProviderImportJobView(job)),
    };
  });

  app.get('/v1/profiles/:profileId/import-connections', { schema: providerConnectionRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    return providerImportService.listConnections(actor.appUserId, params.profileId);
  });

  app.delete('/v1/profiles/:profileId/import-connections/:provider', { schema: providerConnectionDeleteRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string; provider: string };
    return providerImportService.disconnectConnection(actor.appUserId, params.profileId, parseImportProvider(params.provider));
  });

  app.get('/v1/profiles/:profileId/imports/:jobId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string; jobId: string };
    const job = await providerImportService.getJob(actor.appUserId, params.profileId, params.jobId);
    return {
      job: mapProviderImportJobView(job),
    };
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
    return {
      ...completed,
      job: mapProviderImportJobView(completed.job),
    };
  });
}
