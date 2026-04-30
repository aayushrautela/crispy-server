import { AppAuthError } from './app-auth.errors.js';
import { grantMatches } from './app-grant.repo.js';
import type {
  AppGrant,
  AppGrantAction,
  AppGrantResourceType,
  AppPrincipal,
  AppPurpose,
  AppScope,
} from './app-principal.types.js';

export interface AppAuthorizationService {
  requireScope(input: { principal: AppPrincipal; scope: AppScope }): void;
  requireGrant(input: {
    principal: AppPrincipal;
    resourceType: AppGrantResourceType;
    resourceId: string;
    purpose: AppPurpose;
    action: AppGrantAction;
    accountId?: string;
    profileId?: string;
    listKey?: string;
    source?: string;
  }): AppGrant;
  requireOwnedSource(input: { principal: AppPrincipal; source: string }): void;
  requireOwnedListKey(input: { principal: AppPrincipal; source: string; listKey: string }): void;
}

export class DefaultAppAuthorizationService implements AppAuthorizationService {
  requireScope(input: { principal: AppPrincipal; scope: AppScope }): void {
    if (!input.principal.scopes.includes(input.scope)) {
      throw new AppAuthError({
        code: 'app_scope_missing',
        message: `Missing required app scope: ${input.scope}`,
        statusCode: 403,
      });
    }
  }

  requireGrant(input: {
    principal: AppPrincipal;
    resourceType: AppGrantResourceType;
    resourceId: string;
    purpose: AppPurpose;
    action: AppGrantAction;
    accountId?: string;
    profileId?: string;
    listKey?: string;
    source?: string;
  }): AppGrant {
    const grant = input.principal.grants.find((candidate) =>
      grantMatches(candidate, {
        appId: input.principal.appId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        purpose: input.purpose,
        action: input.action,
        accountId: input.accountId,
        profileId: input.profileId,
        listKey: input.listKey,
        source: input.source,
      }),
    );

    if (!grant) {
      throw new AppAuthError({
        code: 'app_grant_missing',
        message: `Missing app grant for ${input.resourceType}/${input.action}.`,
        statusCode: 403,
      });
    }

    return grant;
  }

  requireOwnedSource(input: { principal: AppPrincipal; source: string }): void {
    if (!input.principal.ownedSources.includes(input.source)) {
      throw new AppAuthError({
        code: 'app_grant_missing',
        message: `App does not own source: ${input.source}`,
        statusCode: 403,
      });
    }
  }

  requireOwnedListKey(input: { principal: AppPrincipal; source: string; listKey: string }): void {
    this.requireOwnedSource({ principal: input.principal, source: input.source });
    if (!input.principal.ownedListKeys.includes(input.listKey)) {
      throw new AppAuthError({
        code: 'app_grant_missing',
        message: `App does not own list key: ${input.listKey}`,
        statusCode: 403,
      });
    }
  }
}
