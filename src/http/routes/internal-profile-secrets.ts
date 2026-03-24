import type { FastifyInstance } from 'fastify';
import { ProfileSecretAccessService } from '../../modules/profiles/profile-secret-access.service.js';
import { AccountSettingsService } from '../../modules/users/account-settings.service.js';

export async function registerInternalProfileSecretRoutes(app: FastifyInstance): Promise<void> {
  const secretService = new ProfileSecretAccessService();
  const accountSettingsService = new AccountSettingsService();

  app.get('/internal/v1/profiles/:profileId/secrets/openrouter-key', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['profile-secrets:read']);
    const params = request.params as { profileId: string };
    return {
      secret: await secretService.getOpenRouterKey(params.profileId),
    };
  });

  app.get('/internal/v1/profiles/:profileId/secrets/omdb-api-key', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['profile-secrets:read']);
    const params = request.params as { profileId: string };
    return {
      secret: await accountSettingsService.getOmdbApiKeyForProfile(params.profileId),
    };
  });
}
