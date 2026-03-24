import type { FastifyInstance } from 'fastify';
import type { AuthScope } from '../../modules/auth/auth.types.js';
import { isPersonalAccessTokenScope } from '../../modules/auth/auth.types.js';
import { PersonalAccessTokenService } from '../../modules/auth/personal-access-token.service.js';

export async function registerPersonalAccessTokenRoutes(app: FastifyInstance): Promise<void> {
  const patService = new PersonalAccessTokenService();

  app.get('/v1/auth/personal-access-tokens', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      items: await patService.listForUser(actor.appUserId),
    };
  });

  app.post('/v1/auth/personal-access-tokens', async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const created = await patService.createForUser(actor.appUserId, {
      name: String(body.name ?? '').trim(),
      scopes: parseScopes(body.scopes),
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    });
    reply.code(201);
    return created;
  });

  app.delete('/v1/auth/personal-access-tokens/:tokenId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const params = request.params as { tokenId: string };
    return {
      token: await patService.revokeForUser(actor.appUserId, params.tokenId),
    };
  });
}

function parseScopes(value: unknown): AuthScope[] | undefined {
  return Array.isArray(value) ? value.filter(isPersonalAccessTokenScope) : undefined;
}
