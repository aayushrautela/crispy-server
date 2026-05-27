import type { FastifyInstance } from 'fastify';
import type { AppLoginHandoffService } from '../../modules/auth/app-login-handoff.service.js';
import { success, mutation } from '../response.js';
import { createAppLoginHandoffRouteSchema, exchangeAppLoginHandoffRouteSchema } from '../contracts/auth-handoff.js';

export async function registerAuthHandoffRoutes(
  app: FastifyInstance,
  opts: { appLoginHandoffService: AppLoginHandoffService },
): Promise<void> {
  const appLoginHandoffService = opts.appLoginHandoffService;

  app.post('/v1/auth/app-login/handoff-codes', { schema: createAppLoginHandoffRouteSchema }, async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const created = await appLoginHandoffService.createForUser(actor.authSubject, {
      clientId: String(body.clientId ?? ''),
      returnUri: String(body.returnUri ?? ''),
      codeChallenge: String(body.codeChallenge ?? ''),
      codeChallengeMethod: String(body.codeChallengeMethod ?? ''),
      state: String(body.state ?? ''),
    });
    reply.code(201);
    return mutation(created, request);
  });

  app.post('/v1/auth/app-login/exchange', { schema: exchangeAppLoginHandoffRouteSchema }, async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success(await appLoginHandoffService.exchange({
      code: String(body.code ?? ''),
      codeVerifier: String(body.codeVerifier ?? ''),
      deviceName: body.deviceName === null || typeof body.deviceName === 'string' ? body.deviceName : undefined,
    }), request);
  });
}
