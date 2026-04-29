import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { IntegrationAuthService } from '../../modules/integrations/auth/integration-auth.service.js';
import type { AuthenticatedIntegrationPrincipal } from '../../modules/integrations/auth/integration-auth.types.js';

const integrationAuthService = new IntegrationAuthService();

export async function requireIntegrationAuth(
  request: FastifyRequest,
  _reply?: FastifyReply,
): Promise<AuthenticatedIntegrationPrincipal> {
  const token = getIntegrationToken(request);
  if (!token) {
    throw new HttpError(401, 'Missing integration API key.');
  }

  const principal = await integrationAuthService.authenticateApiKeyToken(token);
  if (!principal) {
    throw new HttpError(401, 'Invalid integration API key.');
  }

  request.integration = principal;
  return principal;
}

function getIntegrationToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization?.trim();
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string') {
    return apiKey.trim();
  }

  if (Array.isArray(apiKey) && typeof apiKey[0] === 'string') {
    return apiKey[0].trim();
  }

  return null;
}
