import type { ResolvedAiRequest } from '../../ai/ai.types.js';
import { AiProviderResolver } from '../../ai/ai-provider-resolver.js';
import type { ConfidentialAiConfig, ConfidentialResourceSelector } from '../types.js';

const PURPOSE_TO_AI_FEATURE = {
  'recommendation-generation': 'insights',
} as const;

export class ConfidentialAiConfigResolver {
  constructor(private readonly aiProviderResolver = new AiProviderResolver()) {}

  async resolve(accountId: string, resource: ConfidentialResourceSelector): Promise<ConfidentialAiConfig> {
    const resolved = await this.aiProviderResolver.resolveForUser(accountId, PURPOSE_TO_AI_FEATURE[resource.purpose]);
    return toConfidentialAiConfig(resolved);
  }
}

function toConfidentialAiConfig(resolved: ResolvedAiRequest): ConfidentialAiConfig {
  return {
    providerId: resolved.providerId,
    providerType: resolved.provider.id,
    endpointUrl: resolved.provider.endpointUrl,
    model: resolved.model,
    httpReferer: resolved.provider.httpReferer,
    title: resolved.provider.title,
    apiKey: resolved.apiKey,
    credentialSource: resolved.credentialSource,
  };
}
