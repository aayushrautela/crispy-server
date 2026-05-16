import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { verifyAuthJwt } from '../../lib/jwks.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor, AuthScope, UserAuthActor } from '../../modules/auth/auth.types.js';
import { USER_DEFAULT_SCOPES } from '../../modules/auth/auth.types.js';
import { PersonalAccessTokenService } from '../../modules/auth/personal-access-token.service.js';
import { db } from '../../lib/db.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthActor;
  }

  interface FastifyInstance {
    requireAuth(request: import('fastify').FastifyRequest): Promise<void>;
    requireUserActor(request: import('fastify').FastifyRequest): UserAuthActor;
    requireUserSessionActor(request: import('fastify').FastifyRequest): UserAuthActor;
    requireScopes(request: import('fastify').FastifyRequest, scopes: AuthScope[]): void;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const patService = new PersonalAccessTokenService();

  fastify.decorateRequest('auth');

  fastify.decorate('requireAuth', async (request: import('fastify').FastifyRequest) => {
    const header = request.headers.authorization?.trim();
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing bearer token.');
    }

    const token = header.slice('Bearer '.length).trim();

    if (token.startsWith('cp_pat_')) {
      const actor = await patService.authenticate(token);
      if (!actor) {
        throw new HttpError(401, 'Invalid bearer token.');
      }
      request.auth = actor;
      request.auth.accessToken = null;
      return;
    }

    let payload;
    try {
      payload = await verifyAuthJwt(token);
    } catch {
      throw new HttpError(401, 'Invalid bearer token.');
    }

    // Bootstrap local account on first login
    const client = await db.connect();
    try {
      await client.query('SELECT identity.upsert_account($1, $2, $3)', [
        payload.sub,
        typeof payload.email === 'string' ? payload.email : null,
        null,
      ]);
    } finally {
      client.release();
    }

    request.auth = {
      type: 'user',
      appUserId: payload.sub,
      serviceId: null,
      scopes: USER_DEFAULT_SCOPES,
      authSubject: payload.sub,
      email: payload.email ?? null,
      tokenId: null,
      consumerId: null,
      accessToken: null,
    };
  });

  fastify.decorate('requireUserActor', (request: import('fastify').FastifyRequest) => {
    const auth = request.auth;
    if (!auth?.appUserId || (auth.type !== 'user' && auth.type !== 'pat')) {
      throw new HttpError(403, 'User authentication required.');
    }
    return auth as UserAuthActor;
  });

  fastify.decorate('requireUserSessionActor', (request: import('fastify').FastifyRequest) => {
    const auth = request.auth;
    if (!auth?.appUserId || auth.type !== 'user') {
      throw new HttpError(403, 'User session authentication required.');
    }
    return auth as UserAuthActor;
  });

  fastify.decorate('requireScopes', (request: import('fastify').FastifyRequest, scopes: AuthScope[]) => {
    const granted = new Set(request.auth?.scopes ?? []);
    for (const scope of scopes) {
      if (!granted.has(scope)) {
        throw new HttpError(403, `Missing required scope: ${scope}`);
      }
    }
  });
};

export default fp(authPlugin, { name: 'auth-plugin' });
