import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { verifySupabaseJwt } from '../../lib/jwks.js';
import { HttpError } from '../../lib/errors.js';
import { UserService } from '../../modules/users/user.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      appUserId: string;
      supabaseAuthUserId: string;
      email: string | null;
    };
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const userService = new UserService();

  fastify.decorateRequest('auth');

  fastify.decorate('requireAuth', async (request: import('fastify').FastifyRequest) => {
    const header = request.headers.authorization?.trim();
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing bearer token.');
    }

    const token = header.slice('Bearer '.length).trim();
    const payload = await verifySupabaseJwt(token);
    request.auth = await userService.ensureAppUser({
      supabaseAuthUserId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
    });
  });
};

export default fp(authPlugin, { name: 'auth-plugin' });
