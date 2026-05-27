import type { FastifyInstance } from 'fastify';
import type { PortalHandoffService } from '../../modules/auth/portal-handoff.service.js';
import { success } from '../response.js';
import { createPortalHandoffRouteSchema, exchangePortalHandoffRouteSchema } from '../contracts/portal-handoff.js';

export async function registerPortalHandoffRoutes(
  app: FastifyInstance,
  opts: { portalHandoffService: PortalHandoffService },
): Promise<void> {
  const portalHandoffService = opts.portalHandoffService;

  app.post('/v1/auth/portal-handoff-codes', { schema: createPortalHandoffRouteSchema }, async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string; appUserId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await portalHandoffService.createForUser(
      actor.authSubject,
      String(body.redirectPath ?? '/account'),
    );
    reply.code(200);
    return success(result, request);
  });

  app.post('/v1/auth/portal-handoff/exchange', { schema: exchangePortalHandoffRouteSchema }, async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success(await portalHandoffService.exchange(String(body.code ?? '')), request);
  });
}
