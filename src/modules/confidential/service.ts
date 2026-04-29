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

export class ConfidentialConfigService {
  constructor(
    private readonly profileService = new ProfileService(),
    private readonly aiConfigResolver = new ConfidentialAiConfigResolver(),
  ) {}

  async resolveBundle(context: ConfidentialBundleContext, request: ConfidentialBundleRequest): Promise<ConfidentialBundleResponse> {
    await this.assertAccountProfileAccess(context.accountId, context.profileId);
    const resources = this.resolveRequestedResource(request);
    this.assertResourceScopes(resources, context.scopes);
    return this.buildBundleResponse(context, resources);
  }

  async assertAccountProfileAccess(accountId: string, profileId: string): Promise<void> {
    await this.profileService.requireOwnedProfile(accountId, profileId);
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
    return {
      accountId: context.accountId,
      profileId: context.profileId,
      resources: await Promise.all(resources.map(async (resource) => {
        const data = await this.aiConfigResolver.resolve(context.accountId, resource);
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

  toPublicError(error: unknown): Error {
    if (error instanceof HttpError) {
      return error;
    }
    return new HttpError(500, 'Failed to resolve confidential config bundle.');
  }
}
