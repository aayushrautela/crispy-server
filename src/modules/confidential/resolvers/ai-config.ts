import type { ResolvedAiRequest } from '../../ai/ai.types.js';
import { AiProviderResolver } from '../../ai/ai-provider-resolver.js';
import type { 
  ConfidentialAiConfig, 
  ConfidentialResourceSelector,
  ConfidentialSecretDeliveryMode,
} from '../types.js';
import type { AppPrincipal } from '../../apps/app-principal.types.js';

const PURPOSE_TO_AI_FEATURE = {
  'recommendation-generation': 'insights',
} as const;

export class ConfidentialAiConfigResolver {
  constructor(private readonly aiProviderResolver = new AiProviderResolver()) {}

  async resolve(
    accountId: string, 
    resource: ConfidentialResourceSelector,
    opts?: { appPrincipal?: AppPrincipal }
  ): Promise<ConfidentialAiConfig> {
    const resolved = await this.aiProviderResolver.resolveForUser(accountId, PURPOSE_TO_AI_FEATURE[resource.purpose]);
    return toConfidentialAiConfig(resolved, opts?.appPrincipal);
  }
}

function toConfidentialAiConfig(resolved: ResolvedAiRequest, appPrincipal?: AppPrincipal): ConfidentialAiConfig {
  const deliveryMode = determineSecretDeliveryMode(appPrincipal);
  
  return {
    provider: {
      providerId: resolved.providerId,
      providerType: resolved.provider.id,
      endpointUrl: resolved.provider.endpointUrl,
      httpReferer: resolved.provider.httpReferer,
      title: resolved.provider.title,
    },
    model: {
      model: resolved.model,
      contextWindow: 128000,
      maxTokens: 4096,
    },
    routing: {
      routeGroup: 'recommendation-generation',
      fallbackEnabled: true,
    },
    generation: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 2048,
    },
    safety: {
      contentFiltering: true,
      piiRedaction: true,
    },
    secretDelivery: buildSecretDelivery(resolved, deliveryMode),
    credentialSource: resolved.credentialSource,
  };
}

function determineSecretDeliveryMode(appPrincipal?: AppPrincipal): ConfidentialSecretDeliveryMode {
  if (!appPrincipal) {
    return 'direct';
  }
  
  const grant = appPrincipal.grants.find(
    (g) => g.resourceType === 'aiConfig' && g.purpose === 'recommendation-generation'
  );
  
  const allowedModes = grant?.constraints.secretDeliveryModes || ['direct'];
  return allowedModes[0] || 'direct';
}

function buildSecretDelivery(
  resolved: ResolvedAiRequest, 
  mode: ConfidentialSecretDeliveryMode
): ConfidentialAiConfig['secretDelivery'] {
  switch (mode) {
    case 'direct':
      return {
        mode: 'direct',
        apiKey: resolved.apiKey,
      };
    case 'proxy':
      return {
        mode: 'proxy',
        proxyEndpoint: '/internal/confidential/v1/ai-proxy',
      };
    case 'reference':
      return {
        mode: 'reference',
        credentialReference: `credential:${resolved.providerId}`,
      };
    default:
      return {
        mode: 'direct',
        apiKey: resolved.apiKey,
      };
  }
}
