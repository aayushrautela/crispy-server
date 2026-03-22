import type { FastifyInstance } from 'fastify';
import { ProviderImportService, parseImportProvider } from '../../modules/imports/provider-import.service.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  const profileService = new ProfileService();
  const providerImportService = new ProviderImportService();

  app.get('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    return {
      profiles: await profileService.listForUser(request.auth!.appUserId),
    };
  });

  app.post('/v1/profiles', async (request) => {
    await app.requireAuth(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.create(request.auth!.appUserId, {
      name: String(body.name ?? '').trim(),
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : null,
      isKids: Boolean(body.isKids),
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return { profile };
  });

  app.patch('/v1/profiles/:profileId', async (request) => {
    await app.requireAuth(request);
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const profile = await profileService.update(request.auth!.appUserId, params.profileId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      avatarKey: typeof body.avatarKey === 'string' ? body.avatarKey : undefined,
      isKids: typeof body.isKids === 'boolean' ? body.isKids : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return { profile };
  });

  app.post('/v1/profiles/:profileId/imports/start', async (request, reply) => {
    await app.requireAuth(request);
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const started = await providerImportService.startReplaceImport(
      request.auth!.appUserId,
      params.profileId,
      parseImportProvider(body.provider),
    );
    reply.code(started.nextAction === 'queued' ? 202 : 201);
    return started;
  });

  app.get('/v1/profiles/:profileId/imports', async (request) => {
    await app.requireAuth(request);
    const params = request.params as { profileId: string };
    return providerImportService.listJobs(request.auth!.appUserId, params.profileId);
  });

  app.get('/v1/profiles/:profileId/imports/:jobId', async (request) => {
    await app.requireAuth(request);
    const params = request.params as { profileId: string; jobId: string };
    return {
      job: await providerImportService.getJob(request.auth!.appUserId, params.profileId, params.jobId),
    };
  });
}
