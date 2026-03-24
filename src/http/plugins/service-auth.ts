import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor } from '../../modules/auth/auth.types.js';
import { ServiceClientRegistry } from '../../modules/auth/service-client-registry.js';

const serviceClientRegistry = new ServiceClientRegistry(env.serviceClients);

const serviceAuthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('requireServiceAuth', async (request: import('fastify').FastifyRequest) => {
    const serviceId = readHeaderValue(request.headers['x-service-id']);
    if (!serviceId) {
      throw new HttpError(401, 'Missing service id.');
    }

    const apiKey = readHeaderValue(request.headers['x-api-key']);
    if (!apiKey) {
      throw new HttpError(401, 'Missing API key.');
    }

    const client = serviceClientRegistry.authenticate(serviceId, apiKey);
    if (!client) {
      throw new HttpError(401, 'Invalid service credentials.');
    }

    request.auth = {
      type: 'service',
      appUserId: null,
      serviceId: client.serviceId,
      scopes: [...client.scopes],
      authSubject: null,
      email: null,
      tokenId: null,
      consumerId: null,
    } satisfies AuthActor;
  });
};

function readHeaderValue(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export default fp(serviceAuthPlugin, { name: 'service-auth-plugin' });
