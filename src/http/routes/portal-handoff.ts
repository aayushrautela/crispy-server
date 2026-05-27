import type { FastifyInstance } from 'fastify';
import type { PortalHandoffService } from '../../modules/auth/portal-handoff.service.js';
import { success } from '../response.js';
import {
  createPortalHandoffRouteSchema,
  exchangePortalHandoffRouteSchema,
  portalSessionRouteSchema,
  portalSignOutRouteSchema,
} from '../contracts/portal-handoff.js';

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

  app.post('/v1/auth/portal-handoff/exchange', { schema: exchangePortalHandoffRouteSchema }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await portalHandoffService.exchange(String(body.code ?? ''));
    const issued = app.issuePortalSession(reply, { accountId: result.accountId, email: result.email });
    return success({
      csrfToken: issued.csrfToken,
      expiresAt: issued.expiresAt,
      user: { id: issued.accountId, email: issued.email },
    });
  });

  app.get('/v1/auth/portal/session', { schema: portalSessionRouteSchema }, async (request) => {
    const session = app.getPortalSession(request);
    if (!session) {
      return success({ user: null });
    }
    return success({
      user: { id: session.accountId, email: session.email },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  app.post('/v1/auth/portal/sign-out', { schema: portalSignOutRouteSchema }, async (request, reply) => {
    app.clearPortalSession(reply);
    return success({ signedOut: true });
  });
}
