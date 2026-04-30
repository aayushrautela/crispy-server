import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppAuthService } from '../../modules/apps/app-auth.service.js';
import type { AppRateLimitService } from '../../modules/apps/app-rate-limit.service.js';
import type { AppAuditRepo } from '../../modules/apps/app-audit.repo.js';
import type { AppPrincipal } from '../../modules/apps/app-principal.types.js';
import { AppAuthError } from '../../modules/apps/app-auth.errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    appPrincipal?: AppPrincipal;
  }

  interface FastifyInstance {
    requireAppAuth(request: FastifyRequest): Promise<AppPrincipal>;
  }
}

export interface AppAuthPluginOptions {
  appAuthService: AppAuthService;
  appRateLimitService: AppRateLimitService;
  appAuditRepo: AppAuditRepo;
}

const appAuthPlugin: FastifyPluginAsync<AppAuthPluginOptions> = async (fastify, options) => {
  const { appAuthService, appAuditRepo } = options;

  fastify.decorateRequest('appPrincipal');

  fastify.decorate('requireAppAuth', async (request: FastifyRequest): Promise<AppPrincipal> => {
    if (request.appPrincipal) {
      return request.appPrincipal;
    }

    try {
      const principal = await appAuthService.authenticateRequest(request);
      request.appPrincipal = principal;

      await appAuditRepo.insert({
        appId: principal.appId,
        keyId: principal.keyId,
        action: 'app_authenticated',
        requestId: request.id,
        metadata: {
          method: request.method,
          url: request.url,
        },
      }).catch((err) => {
        request.log.warn({ err }, 'Failed to audit app authentication');
      });

      return principal;
    } catch (error) {
      if (error instanceof AppAuthError) {
        await appAuditRepo.insert({
          appId: 'unknown',
          action: 'app_auth_failed',
          requestId: request.id,
          metadata: {
            code: error.code,
            method: request.method,
            url: request.url,
          },
        }).catch((err) => {
          request.log.warn({ err }, 'Failed to audit app auth failure');
        });
      }
      throw error;
    }
  });
};

export default fp(appAuthPlugin, { name: 'app-auth-plugin' });
