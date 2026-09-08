import type { FastifyInstance } from 'fastify';
import type { DeviceAuthorizationService } from '../../modules/auth/device-authorization.service.js';
import { success } from '../response.js';
import {
  approveDeviceUserCodeRouteSchema,
  createDeviceAuthorizationRouteSchema,
  denyDeviceUserCodeRouteSchema,
  lookupDeviceUserCodeRouteSchema,
  pollDeviceTokenRouteSchema,
} from '../contracts/auth-device.js';

export async function registerAuthDeviceRoutes(
  app: FastifyInstance,
  opts: { deviceAuthorizationService: DeviceAuthorizationService },
): Promise<void> {
  const deviceAuthorizationService = opts.deviceAuthorizationService;

  app.post('/v1/auth/device/authorize', { schema: createDeviceAuthorizationRouteSchema }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const created = await deviceAuthorizationService.createAuthorization({
      clientId: String(body.clientId ?? ''),
      deviceName: body.deviceName === null || typeof body.deviceName === 'string' ? body.deviceName : undefined,
      ip: request.ip,
    });
    reply.code(201);
    return success(created, request);
  });

  app.post('/v1/auth/device/token', { schema: pollDeviceTokenRouteSchema }, async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await deviceAuthorizationService.poll({
      deviceCode: String(body.deviceCode ?? ''),
    });
    if (result.kind === 'authorization_pending') {
      return success({ status: 'authorization_pending' }, request);
    }
    if (result.kind === 'slow_down') {
      return success({ status: 'slow_down', interval: result.interval }, request);
    }
    if (result.kind === 'access_denied') {
      return success({ status: 'access_denied' }, request);
    }
    if (result.kind === 'expired_token') {
      return success({ status: 'expired_token' }, request);
    }
    return success({
      status: 'approved',
      plaintextToken: result.plaintextToken,
      token: result.token,
      user: result.user,
    }, request);
  });

  app.post('/v1/auth/device/verification', { schema: lookupDeviceUserCodeRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success(await deviceAuthorizationService.lookupForApproval(actor.authSubject, {
      userCode: String(body.userCode ?? ''),
    }), request);
  });

  app.post('/v1/auth/device/verification/approve', { schema: approveDeviceUserCodeRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success(await deviceAuthorizationService.approve(actor.authSubject, {
      userCode: String(body.userCode ?? ''),
    }), request);
  });

  app.post('/v1/auth/device/verification/deny', { schema: denyDeviceUserCodeRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success(await deviceAuthorizationService.deny({
      userCode: String(body.userCode ?? ''),
    }), request);
  });
}
