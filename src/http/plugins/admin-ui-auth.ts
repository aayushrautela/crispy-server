import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireAdminUi(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): Promise<void>;
  }
}

const adminUiAuthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('requireAdminUi', async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const configuredUser = env.adminUiUser.trim();
    const configuredPassword = env.adminUiPassword.trim();
    if (!configuredUser || !configuredPassword) {
      throw new HttpError(503, 'Admin UI credentials are not configured.');
    }

    const header = request.headers.authorization;
    if (!header?.startsWith('Basic ')) {
      requestAdminAuth(reply);
      throw new HttpError(401, 'Admin authentication required.');
    }

    let providedUser = '';
    let providedPassword = '';
    try {
      const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator >= 0) {
        providedUser = decoded.slice(0, separator);
        providedPassword = decoded.slice(separator + 1);
      }
    } catch {
      requestAdminAuth(reply);
      throw new HttpError(401, 'Invalid admin authentication header.');
    }

    if (!constantTimeMatch(providedUser, configuredUser) || !constantTimeMatch(providedPassword, configuredPassword)) {
      requestAdminAuth(reply);
      throw new HttpError(401, 'Invalid admin credentials.');
    }
  });
};

export default fp(adminUiAuthPlugin, { name: 'admin-ui-auth-plugin' });

function requestAdminAuth(reply: import('fastify').FastifyReply): void {
  reply.header('WWW-Authenticate', 'Basic realm="Crispy Admin"');
}

function constantTimeMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
