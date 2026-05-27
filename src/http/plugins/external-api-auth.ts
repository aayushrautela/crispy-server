import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { ExternalApiKeyService } from '../../modules/auth/external-api-key.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireExternalApiAuth(request: import('fastify').FastifyRequest): Promise<void>;
  }
}

const externalApiAuthPlugin: FastifyPluginAsync = async (fastify) => {
  const service = new ExternalApiKeyService();

  fastify.decorate('requireExternalApiAuth', async (request: import('fastify').FastifyRequest) => {
    const header = request.headers.authorization?.trim();
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing bearer token.');
    }

    const token = header.slice('Bearer '.length).trim();
    const actor = await service.authenticate(token);
    if (!actor) {
      throw new HttpError(401, 'Invalid external API key.');
    }

    request.auth = actor;
  });
};

export default fp(externalApiAuthPlugin, { name: 'external-api-auth-plugin', dependencies: ['auth-plugin'] });
