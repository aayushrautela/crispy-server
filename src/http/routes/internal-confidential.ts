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
    
    // Try app auth first, fall back to service auth for backwards compatibility
    let context: ConfidentialBundleContext;
    
    try {
      const principal = await app.requireAppAuth(request);
      context = {
        authType: 'app',
        accountId: params.accountId,
        profileId: params.profileId,
        scopes: principal.scopes,
        actor: { type: 'app', principal },
      };
    } catch (appAuthError) {
      // Fall back to service auth
      await app.requireServiceAuth(request);
      app.requireScopes(request, ['confidential-config:ai-config:read']);
      
      const auth = request.auth;
      if (auth?.type !== 'service' || !auth.serviceId) {
        throw confidentialConfigService.toPublicError(new Error('Service or app authentication is required.'));
      }
      
      context = {
        authType: 'service',
        accountId: params.accountId,
        profileId: params.profileId,
        scopes: auth.scopes,
        actor: { type: 'service', serviceId: auth.serviceId },
      };
    }

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
