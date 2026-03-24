import { timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor } from '../../modules/auth/auth.types.js';
import { SERVICE_DEFAULT_SCOPES } from '../../modules/auth/auth.types.js';

const serviceAuthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('requireServiceAuth', async (request: import('fastify').FastifyRequest) => {
    const header = request.headers['x-api-key'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided?.trim()) {
      throw new HttpError(401, 'Missing API key.');
    }

    const expected = env.recommendationApiKey;
    if (!expected || !safeEqual(provided.trim(), expected)) {
      throw new HttpError(401, 'Invalid API key.');
    }

    request.auth = {
      type: 'service',
      appUserId: null,
      serviceId: 'recommendation-service',
      scopes: SERVICE_DEFAULT_SCOPES,
      authSubject: null,
      email: null,
      tokenId: null,
      consumerId: null,
    } satisfies AuthActor;
  });
};

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export default fp(serviceAuthPlugin, { name: 'service-auth-plugin' });
