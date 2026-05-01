import type { FastifyInstance } from 'fastify';
import { ConfidentialConfigService, parseConfidentialBundleRequest } from '../../modules/confidential/index.js';
import type { ConfidentialBundleContext } from '../../modules/confidential/types.js';

export interface InternalConfidentialRoutesDeps {
  confidentialConfigService: ConfidentialConfigService;
}

export async function registerInternalConfidentialRoutes(
  app: FastifyInstance, 
  deps?: InternalConfidentialRoutesDeps
): Promise<void> {
  const confidentialConfigService = deps?.confidentialConfigService || new ConfidentialConfigService();

  app.post('/internal/confidential/v1/accounts/:accountId/profiles/:profileId/config-bundle', async (request) => {
    const params = request.params as { accountId: string; profileId: string };
    const principal = await app.requireRecommenderAuth(request);
    const context: ConfidentialBundleContext = {
      authType: 'app',
      accountId: params.accountId,
      profileId: params.profileId,
      scopes: principal.scopes,
      actor: { type: 'app', principal },
    };

    try {
      return await confidentialConfigService.resolveBundle(
        context,
        parseConfidentialBundleRequest(request.body),
      );
    } catch (error) {
      throw confidentialConfigService.toPublicError(error);
    }
  });
}
