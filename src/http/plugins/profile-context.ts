import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError } from '../../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    profileId?: string;
  }
}

const profileContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('profileId');

  fastify.addHook('preHandler', async (request) => {
    const header = request.headers['x-profile-id'];
    const value = Array.isArray(header) ? header[0] : header;
    request.profileId = value?.trim() || undefined;
  });

  fastify.decorate('requireProfileId', (request: import('fastify').FastifyRequest) => {
    if (!request.profileId) {
      throw new HttpError(400, 'Missing X-Profile-Id header.');
    }
    return request.profileId;
  });
};

export default fp(profileContextPlugin, { name: 'profile-context-plugin' });
