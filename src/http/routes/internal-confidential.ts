import type { FastifyInstance } from 'fastify';
import { ConfidentialConfigService, parseConfidentialBundleRequest } from '../../modules/confidential/index.js';

export async function registerInternalConfidentialRoutes(app: FastifyInstance): Promise<void> {
  const confidentialConfigService = new ConfidentialConfigService();

  app.post('/internal/confidential/v1/accounts/:accountId/profiles/:profileId/config-bundle', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['confidential-config:ai-config:read']);

    const params = request.params as { accountId: string; profileId: string };
    const auth = request.auth;
    if (auth?.type !== 'service' || !auth.serviceId) {
      throw confidentialConfigService.toPublicError(new Error('Service authentication is required.'));
    }

    try {
      return await confidentialConfigService.resolveBundle(
        {
          accountId: params.accountId,
          profileId: params.profileId,
          serviceId: auth.serviceId,
          scopes: auth.scopes,
        },
        parseConfidentialBundleRequest(request.body),
      );
    } catch (error) {
      throw confidentialConfigService.toPublicError(error);
    }
  });
}
