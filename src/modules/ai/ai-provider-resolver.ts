import { AiCredentialResolver, type AiTaskId } from './ai-credential-resolver.service.js';
import type { AiFeatureId, ResolvedAiRequest } from './ai.types.js';

export class AiProviderResolver {
  private readonly credentialResolver: AiCredentialResolver;

  constructor(serverApiKey?: string) {
    this.credentialResolver = new AiCredentialResolver(serverApiKey);
  }

  async resolveForUser(
    userId: string,
    feature: AiFeatureId,
  ): Promise<ResolvedAiRequest> {
    return this.credentialResolver.resolveForTask(userId, toTaskId(feature));
  }
}

function toTaskId(feature: AiFeatureId): AiTaskId {
  return feature as AiTaskId;
}

export function buildAiInsightsGenerationVersion(request: Pick<ResolvedAiRequest, 'providerId' | 'model'>): string {
  const provider = request.providerId.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
  const model = request.model.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
  return `${provider}:${model}`;
}
