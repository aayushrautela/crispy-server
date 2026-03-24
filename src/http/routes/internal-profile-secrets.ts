import type { FastifyInstance } from 'fastify';
import { ProfileSecretAccessService } from '../../modules/profiles/profile-secret-access.service.js';

export async function registerInternalProfileSecretRoutes(app: FastifyInstance): Promise<void> {
  const secretService = new ProfileSecretAccessService();

  app.get('/internal/v1/profiles/:profileId/secrets/openrouter-key', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['profile-secrets:read']);
    const params = request.params as { profileId: string };
    return {
      secret: await secretService.getOpenRouterKey(params.profileId),
    };
  });
}
