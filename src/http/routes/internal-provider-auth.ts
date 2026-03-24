import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { ProviderTokenAccessService } from '../../modules/imports/provider-token-access.service.js';
import { isProviderImportProvider, type ProviderImportProvider } from '../../modules/imports/provider-import.types.js';

export async function registerInternalProviderAuthRoutes(app: FastifyInstance): Promise<void> {
  const providerTokenService = new ProviderTokenAccessService();

  app.get('/internal/v1/profiles/:profileId/providers/:provider/connection', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['provider-connections:read']);
    const params = parseParams(request.params);
    return {
      connection: await providerTokenService.getConnection(params.profileId, params.provider),
    };
  });

  app.get('/internal/v1/profiles/:profileId/providers/:provider/token-status', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['provider-tokens:read']);
    const params = parseParams(request.params);
    return {
      tokenStatus: await providerTokenService.getTokenStatus(params.profileId, params.provider),
    };
  });

  app.post('/internal/v1/profiles/:profileId/providers/:provider/access-token', async (request) => {
    await app.requireServiceAuth(request);
    const params = parseParams(request.params);
    const forceRefresh = parseForceRefresh(request.body);
    app.requireScopes(request, forceRefresh ? ['provider-tokens:read', 'provider-tokens:refresh'] : ['provider-tokens:read']);
    return {
      accessToken: await providerTokenService.getAccessToken(params.profileId, params.provider, { forceRefresh }),
    };
  });

  app.post('/internal/v1/profiles/:profileId/providers/:provider/refresh', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['provider-tokens:refresh']);
    const params = parseParams(request.params);
    return {
      accessToken: await providerTokenService.getAccessToken(params.profileId, params.provider, { forceRefresh: true }),
    };
  });
}

function parseParams(value: unknown): { profileId: string; provider: ProviderImportProvider } {
  const params = asRecord(value);
  const profileId = typeof params.profileId === 'string' && params.profileId.trim() ? params.profileId.trim() : null;
  const provider = params.provider;
  if (!profileId) {
    throw new HttpError(400, 'profileId is required.');
  }

  if (!isProviderImportProvider(provider)) {
    throw new HttpError(400, 'Invalid provider.');
  }

  return { profileId, provider };
}

function parseForceRefresh(value: unknown): boolean {
  const body = asRecord(value);
  return body.forceRefresh === true || body.forceRefresh === 'true';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
