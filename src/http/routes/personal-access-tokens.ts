import type { FastifyInstance } from 'fastify';
import type { AuthScope } from '../../modules/auth/auth.types.js';
import { isPersonalAccessTokenScope } from '../../modules/auth/auth.types.js';
import { PersonalAccessTokenService } from '../../modules/auth/personal-access-token.service.js';
import { success, mutation } from '../response.js';

export async function registerPersonalAccessTokenRoutes(app: FastifyInstance): Promise<void> {
  const patService = new PersonalAccessTokenService();

  app.get('/v1/auth/personal-access-tokens', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    return success({
      items: await patService.listForUser(actor.appUserId),
    }, request);
  });

  app.post('/v1/auth/personal-access-tokens', async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const created = await patService.createForUser(actor.appUserId, {
      name: String(body.name ?? '').trim(),
      scopes: parseScopes(body.scopes),
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    });
    reply.code(201);
    return mutation({ token: created }, request);
  });

  app.delete('/v1/auth/personal-access-tokens/:tokenId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as { tokenId: string };
    return success({
      token: await patService.revokeForUser(actor.appUserId, params.tokenId),
    }, request);
  });
}

function parseScopes(value: unknown): AuthScope[] | undefined {
  return Array.isArray(value) ? value.filter(isPersonalAccessTokenScope) : undefined;
}
