import type { FastifyInstance } from 'fastify';
import { ProviderImportService, parseImportProvider } from '../../modules/imports/provider-import.service.js';
import { mapProviderImportJobView } from '../../modules/imports/provider-import.views.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import { mapProfileView } from '../../modules/profiles/profile.views.js';

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  const profileService = new ProfileService();
  const providerImportService = new ProviderImportService();

  app.get('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    return {
      profiles: (await profileService.listForUser(actor.appUserId)).map((profile) => mapProfileView(profile)),
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

  app.post('/v1/profiles/:profileId/imports/start', async (request, reply) => {
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

  app.get('/v1/profiles/:profileId/import-connections', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    return providerImportService.listConnections(actor.appUserId, params.profileId);
  });

  app.delete('/v1/profiles/:profileId/import-connections/:provider', async (request) => {
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
