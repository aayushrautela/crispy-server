import { appConfig } from '../../config/app-config.js';
import { env } from '../../config/env.js';
import { AiCredentialResolver, type AiTaskId } from './ai-credential-resolver.service.js';
import type { AiCredentialSource, AiFeatureId, ResolvedAiRequest } from './ai.types.js';

export class AiProviderResolver {
  constructor(
    accountSettingsService?: ConstructorParameters<typeof AiCredentialResolver>[0],
    serverKeys = env.aiServerKeys,
  ) {
    this.credentialResolver = new AiCredentialResolver(accountSettingsService, serverKeys);
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

export function listConfiguredServerAiProviders(): string[] {
  const configured = new Set(env.aiServerKeys.map((entry) => entry.providerId));
  return Object.keys(appConfig.ai.providers).filter((providerId) => configured.has(providerId));
}

export function toResolvedRequestKey(
  source: AiCredentialSource,
  providerId: string,
  model: string,
  apiKey: string,
): string {
  return `${source}:${providerId}:${model}:${apiKey}`;
}
