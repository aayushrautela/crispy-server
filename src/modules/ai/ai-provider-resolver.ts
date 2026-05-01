import { AiCredentialResolver, type AiTaskId } from './ai-credential-resolver.service.js';
import type { AiCredentialSource, AiFeatureId, ResolvedAiRequest } from './ai.types.js';

export class AiProviderResolver {
  constructor(
    accountSettingsService?: ConstructorParameters<typeof AiCredentialResolver>[0],
    serverApiKey?: ConstructorParameters<typeof AiCredentialResolver>[1],
  ) {
    this.credentialResolver = new AiCredentialResolver(accountSettingsService, serverApiKey);
  }

  private readonly credentialResolver: AiCredentialResolver;

  async resolveForUser(
    userId: string,
    feature: AiFeatureId,
    _options?: { excludeRequestKeys?: Set<string> },
  ): Promise<ResolvedAiRequest> {
    return this.credentialResolver.resolveForTask(userId, toTaskId(feature));
  }
}

function toTaskId(feature: AiFeatureId): AiTaskId {
  return feature;
}

export function buildAiInsightsGenerationVersion(request: Pick<ResolvedAiRequest, 'providerId' | 'model'>): string {
  const provider = request.providerId.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
  const model = request.model.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
  return `${provider}:${model}`;
}

export function toResolvedRequestKey(
  source: AiCredentialSource,
  providerId: string,
  model: string,
  apiKey: string,
): string {
  return `${source}:${providerId}:${model}:${apiKey}`;
}
