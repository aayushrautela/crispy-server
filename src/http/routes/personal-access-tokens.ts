import type { FastifyInstance } from 'fastify';
import type { AuthScope } from '../../modules/auth/auth.types.js';
import { isPersonalAccessTokenScope } from '../../modules/auth/auth.types.js';
import { PersonalAccessTokenService } from '../../modules/auth/personal-access-token.service.js';
import type { SupabasePersonalAccessTokenService } from '../../modules/auth/supabase-personal-access-token.service.js';
import { success, mutation } from '../response.js';

export async function registerPersonalAccessTokenRoutes(
  app: FastifyInstance,
  opts?: { supabasePatService?: SupabasePersonalAccessTokenService },
): Promise<void> {
  const localPatService = new PersonalAccessTokenService();

  function getPatService(): PersonalAccessTokenService | SupabasePersonalAccessTokenService {
    return opts?.supabasePatService ?? localPatService;
  }

  app.get('/v1/auth/personal-access-tokens', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request) as { appUserId: string; authSubject: string };
    const patService = getPatService();
    const accountId = opts?.supabasePatService ? actor.authSubject : actor.appUserId;
    return success({
      items: await patService.listForUser(accountId),
    }, request);
  });

  app.post('/v1/auth/personal-access-tokens', async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request) as { appUserId: string; authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const patService = getPatService();
    const accountId = opts?.supabasePatService ? actor.authSubject : actor.appUserId;
    const created = await patService.createForUser(accountId, {
      name: String(body.name ?? '').trim(),
      scopes: parseScopes(body.scopes),
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    });
    reply.code(201);
    return mutation({ token: created }, request);
  });

  app.delete('/v1/auth/personal-access-tokens/:tokenId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request) as { appUserId: string; authSubject: string };
    const params = request.params as { tokenId: string };
    const patService = getPatService();
    const accountId = opts?.supabasePatService ? actor.authSubject : actor.appUserId;
    return success({
      token: await patService.revokeForUser(accountId, params.tokenId),
    }, request);
  });
}

function parseScopes(value: unknown): AuthScope[] | undefined {
  return Array.isArray(value) ? value.filter(isPersonalAccessTokenScope) : undefined;
}
