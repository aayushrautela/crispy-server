import { HttpError } from '../../lib/errors.js';
import type { AuthScope } from '../auth/auth.types.js';
import { ProfileService } from '../profiles/profile.service.js';
import { ConfidentialResourceForbiddenError, ConfidentialResourceNotFoundError } from './errors.js';
import { getConfidentialResourceDefinition, isConfidentialResourceSelector } from './registry.js';
import { ConfidentialAiConfigResolver } from './resolvers/ai-config.js';
import type {
  ConfidentialBundleContext,
  ConfidentialBundleRequest,
  ConfidentialBundleResponse,
  ConfidentialResourceSelector,
} from './types.js';
import type { ProfileEligibilityService } from '../apps/profile-eligibility.service.js';
import type { AppAuthorizationService } from '../apps/app-authorization.service.js';
import type { AppAuditRepo } from '../apps/app-audit.repo.js';

export interface ConfidentialConfigServiceDeps {
  profileService?: ProfileService;
  aiConfigResolver?: ConfidentialAiConfigResolver;
  profileEligibilityService?: ProfileEligibilityService;
  appAuthorizationService?: AppAuthorizationService;
  appAuditRepo?: AppAuditRepo;
}

export class ConfidentialConfigService {
  private readonly profileService: ProfileService;
  private readonly aiConfigResolver: ConfidentialAiConfigResolver;
  private readonly profileEligibilityService?: ProfileEligibilityService;
  private readonly appAuthorizationService?: AppAuthorizationService;
  private readonly appAuditRepo?: AppAuditRepo;

  constructor(deps?: ConfidentialConfigServiceDeps) {
    this.profileService = deps?.profileService || new ProfileService();
    this.aiConfigResolver = deps?.aiConfigResolver || new ConfidentialAiConfigResolver();
    this.profileEligibilityService = deps?.profileEligibilityService;
    this.appAuthorizationService = deps?.appAuthorizationService;
    this.appAuditRepo = deps?.appAuditRepo;
  }

  async resolveBundle(context: ConfidentialBundleContext, request: ConfidentialBundleRequest): Promise<ConfidentialBundleResponse> {
    await this.assertAccountProfileAccess(context.accountId, context.profileId);
    const resources = this.resolveRequestedResource(request);
    await this.assertResourceAuthorization(context, resources);
    await this.assertProfileEligibility(context, resources);
    const response = await this.buildBundleResponse(context, resources);
    await this.auditConfidentialAccess(context, resources);
    return response;
  }

  async assertAccountProfileAccess(accountId: string, profileId: string): Promise<void> {
    await this.profileService.requireOwnedProfile(accountId, profileId);
  }

  async assertResourceAuthorization(context: ConfidentialBundleContext, resources: ConfidentialResourceSelector[]): Promise<void> {
    if (context.authType === 'app') {
      // App principal: require scope + grant
      const principal = context.actor.principal;
      
      for (const resource of resources) {
        const definition = getConfidentialResourceDefinition(resource);
        if (!definition) {
          throw new ConfidentialResourceNotFoundError(resource.kind);
        }

        // Check scope
        if (!this.appAuthorizationService) {
          throw new HttpError(500, 'App authorization service not configured.');
        }
        this.appAuthorizationService.requireScope({ 
          principal, 
          scope: 'confidential-config:ai-config:read' 
        });

        // Check grant
        this.appAuthorizationService.requireGrant({
          principal,
          resourceType: 'aiConfig',
          resourceId: '*',
          purpose: resource.purpose,
          action: 'read',
          accountId: context.accountId,
          profileId: context.profileId,
        });
      }
    } else {
      // Service auth: check scopes only (backwards compatibility)
      this.assertResourceScopes(resources, context.scopes);
    }
  }

  assertResourceScopes(resources: ConfidentialResourceSelector[], scopes: AuthScope[]): void {
    const granted = new Set(scopes);
    for (const resource of resources) {
      const definition = getConfidentialResourceDefinition(resource);
      if (!definition) {
        throw new ConfidentialResourceNotFoundError(resource.kind);
      }
      if (!definition.requiredScopes.every((scope) => granted.has(scope))) {
        throw new ConfidentialResourceForbiddenError(resource.kind);
      }
    }
  }

  async assertProfileEligibility(context: ConfidentialBundleContext, resources: ConfidentialResourceSelector[]): Promise<void> {
    if (context.authType !== 'app' || !this.profileEligibilityService) {
      return;
    }

    for (const resource of resources) {
      if (resource.kind === 'aiConfig' && resource.purpose === 'recommendation-generation') {
        const eligibility = await this.profileEligibilityService.check({
          principal: context.actor.principal,
          accountId: context.accountId,
          profileId: context.profileId,
          purpose: 'recommendation-generation',
          requireAiPersonalization: true,
        });

        if (!eligibility.eligible) {
          throw new HttpError(
            403, 
            `Profile is not eligible for AI personalization: ${eligibility.reasons.join(', ')}`
          );
        }
      }
    }
  }

  resolveRequestedResource(request: ConfidentialBundleRequest): ConfidentialResourceSelector[] {
    if (request.resources.length === 0) {
      throw new HttpError(400, 'At least one resource is required.');
    }

    return request.resources.map((resource) => {
      if (!isConfidentialResourceSelector(resource)) {
        throw new ConfidentialResourceNotFoundError(`${resource.kind}:${resource.version}:${resource.purpose}`);
      }
      return resource;
    });
  }

  async buildBundleResponse(
    context: ConfidentialBundleContext,
    resources: ConfidentialResourceSelector[],
  ): Promise<ConfidentialBundleResponse> {
    const appPrincipal = context.authType === 'app' ? context.actor.principal : undefined;
    
    return {
      accountId: context.accountId,
      profileId: context.profileId,
      resources: await Promise.all(resources.map(async (resource) => {
        const data = await this.aiConfigResolver.resolve(context.accountId, resource, { appPrincipal });
        return {
          ...resource,
          data,
          metadata: {
            cache: {
              ttlSeconds: 300,
              scope: 'account-profile' as const,
            },
            credentialSource: data.credentialSource,
            resolvedAt: new Date().toISOString(),
          },
        };
      })),
    };
  }

  async auditConfidentialAccess(context: ConfidentialBundleContext, resources: ConfidentialResourceSelector[]): Promise<void> {
    if (context.authType !== 'app' || !this.appAuditRepo) {
      return;
    }

    const principal = context.actor.principal;
    await this.appAuditRepo.insert({
      appId: principal.appId,
      keyId: principal.keyId,
      action: 'confidential_config_bundle_read',
      accountId: context.accountId,
      profileId: context.profileId,
      resourceType: 'aiConfig',
      resourceId: resources.map((r) => `${r.kind}:${r.version}:${r.purpose}`).join(','),
      metadata: {
        resourceCount: resources.length,
        purposes: [...new Set(resources.map((r) => r.purpose))],
      },
    });
  }

  toPublicError(error: unknown): Error {
    if (error instanceof HttpError) {
      return error;
    }
    return new HttpError(500, 'Failed to resolve confidential config bundle.');
  }
}
