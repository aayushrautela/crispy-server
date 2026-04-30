import type { FastifyRequest } from 'fastify';
import type { AppPrincipal, AppScope, AppGrantResourceType, AppGrantAction, AppPurpose } from '../../modules/apps/app-principal.types.js';
import { AppAuthError } from '../../modules/apps/app-auth.errors.js';

export type RoutePreHandler = (request: FastifyRequest) => Promise<void>;

export function requireAppScope(scope: AppScope): RoutePreHandler {
  return async (request: FastifyRequest) => {
    const principal = request.appPrincipal;
    if (!principal) {
      throw new AppAuthError({
        code: 'missing_app_credentials',
        message: 'App authentication required.',
        statusCode: 401,
      });
    }

    if (!principal.scopes.includes(scope)) {
      throw new AppAuthError({
        code: 'app_scope_missing',
        message: `Missing required app scope: ${scope}`,
        statusCode: 403,
      });
    }
  };
}

export function requireAppGrant(input: {
  resourceType: AppGrantResourceType;
  resourceIdFromRequest?: (request: FastifyRequest) => string;
  purposeFromRequest?: (request: FastifyRequest) => AppPurpose;
  action: AppGrantAction;
}): RoutePreHandler {
  return async (request: FastifyRequest) => {
    const principal = request.appPrincipal;
    if (!principal) {
      throw new AppAuthError({
        code: 'missing_app_credentials',
        message: 'App authentication required.',
        statusCode: 401,
      });
    }

    const resourceId = input.resourceIdFromRequest ? input.resourceIdFromRequest(request) : '*';
    const purpose = input.purposeFromRequest ? input.purposeFromRequest(request) : 'recommendation-generation';

    const hasGrant = principal.grants.some((grant) => {
      if (grant.resourceType !== input.resourceType) return false;
      if (grant.resourceId !== '*' && grant.resourceId !== resourceId) return false;
      if (grant.purpose !== purpose) return false;
      if (!grant.actions.includes(input.action)) return false;
      return true;
    });

    if (!hasGrant) {
      throw new AppAuthError({
        code: 'app_grant_missing',
        message: `Missing app grant for ${input.resourceType}/${input.action}.`,
        statusCode: 403,
      });
    }
  };
}
