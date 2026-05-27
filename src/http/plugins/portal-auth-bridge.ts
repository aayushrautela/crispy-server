import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../lib/errors.js';
import { USER_DEFAULT_SCOPES, type UserAuthActor } from '../../modules/auth/auth.types.js';
import { PersonalAccessTokenService } from '../../modules/auth/personal-access-token.service.js';
import { verifyAndUpsertAuthJwt } from '../auth-helpers.js';

declare module 'fastify' {
  interface FastifyInstance {
    portalOptionalUserAuth(request: import('fastify').FastifyRequest): Promise<void>;
    portalRequireUserMutation(request: import('fastify').FastifyRequest): UserAuthActor;
  }
}

const portalAuthBridgePlugin: FastifyPluginAsync = async (fastify) => {
  const patService = new PersonalAccessTokenService();

  fastify.decorate('portalOptionalUserAuth', async (request: import('fastify').FastifyRequest) => {
    const header = request.headers.authorization?.trim();

    if (header?.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();

      if (token.startsWith('cp_pat_')) {
        const actor = await patService.authenticate(token);
        if (actor) {
          request.auth = actor;
          request.auth.accessToken = null;
          request.portalAuthOrigin = 'pat';
          return;
        }
      } else {
        try {
          request.auth = await verifyAndUpsertAuthJwt(token);
          request.portalAuthOrigin = 'jwt';
          return;
        } catch {
          // fall through to portal session
        }
      }
    }

    const session = fastify.getPortalSession(request);
    if (!session) {
      throw new HttpError(401, 'Authentication required.');
    }

    request.auth = {
      type: 'user',
      appUserId: session.accountId,
      serviceId: null,
      scopes: USER_DEFAULT_SCOPES,
      authSubject: session.accountId,
      email: session.email ?? null,
      tokenId: null,
      consumerId: null,
      accessToken: null,
    } satisfies UserAuthActor;
    request.portalAuthOrigin = 'cookie';
  });

  fastify.decorate('portalRequireUserMutation', (request: import('fastify').FastifyRequest) => {
    const actor = fastify.requireUserActor(request);

    if (request.portalAuthOrigin === 'cookie') {
      const session = request.portalSession;
      if (!session) {
        throw new HttpError(403, 'Portal session required for CSRF validation.');
      }
      const csrfToken = readHeaderValue(request.headers['x-portal-csrf']);
      if (!csrfToken || !constantTimeMatch(csrfToken, session.csrfToken)) {
        throw new HttpError(403, 'Invalid portal CSRF token.');
      }
    }

    return actor;
  });
};

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' && value[0].trim() ? value[0].trim() : null;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function constantTimeMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export default fp(portalAuthBridgePlugin, { name: 'portal-auth-bridge-plugin',
  dependencies: ['auth-plugin', 'portal-session-auth-plugin'],
});
