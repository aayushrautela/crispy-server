import type { AiCredentialSource, AiFeatureId, AiProviderView } from '../modules/ai/ai.types.js';

type AiProviderSelection =
  | { type: 'account' }
  | { type: 'fixed'; providerId: string };

type AiFeaturePolicy = {
  fallback: Array<{
    source: AiCredentialSource;
    provider: AiProviderSelection;
  }>;
};

export type AppAiProviderConfig = AiProviderView & {
  httpReferer: string;
  title: string;
  models: Record<AiFeatureId, string>;
};

const aiProviders: Record<string, AppAiProviderConfig> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    endpointUrl: 'https://api.openai.com/v1/chat/completions',
    httpReferer: '',
    title: '',
    models: {
      search: 'gpt-4o-mini',
      insights: 'gpt-4o-mini',
    },
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    endpointUrl: 'https://openrouter.ai/api/v1/chat/completions',
    httpReferer: '',
    title: '',
    models: {
      search: 'openai/gpt-4o-mini',
      insights: 'openai/gpt-4o-mini',
    },
  },
};

const aiFeaturePolicies: Record<AiFeatureId, AiFeaturePolicy> = {
  search: {
    fallback: [
      { source: 'user', provider: { type: 'account' } },
      { source: 'server', provider: { type: 'fixed', providerId: 'openai' } },
      { source: 'shared_pool', provider: { type: 'account' } },
    ],
  },
  insights: {
    fallback: [
      { source: 'user', provider: { type: 'account' } },
      { source: 'server', provider: { type: 'fixed', providerId: 'openai' } },
      { source: 'shared_pool', provider: { type: 'account' } },
    ],
  },
};

export const appConfig = {
  defaults: {
    profileGroupName: 'Crispy Profile Group',
    profileName: 'Main',
  },
  cache: {
    homeTtlSeconds: 120,
    calendarTtlSeconds: 300,
    tmdb: {
      movieTtlHours: 168,
      showTtlHours: 24,
      seasonTtlHours: 24,
    },
  },
  metadata: {
    tmdb: {
      baseUrl: 'https://api.themoviedb.org/3',
      imageBaseUrl: 'https://image.tmdb.org/t/p',
    },
  },
  ai: {
    defaultProviderId: 'openai',
    providers: aiProviders,
    features: aiFeaturePolicies,
  },
} as const;

export function listAiProviders(): AppAiProviderConfig[] {
  return Object.values(appConfig.ai.providers);
}

export function listPublicAiProviders(): AiProviderView[] {
  return listAiProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
    endpointUrl: provider.endpointUrl,
  }));
}

export function isAiProviderId(value: string): boolean {
  return Object.hasOwn(aiProviders, value);
}

export function normalizeAiProviderId(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return isAiProviderId(normalized) ? normalized : appConfig.ai.defaultProviderId;
}

export function requireAiProvider(providerId: string): AppAiProviderConfig {
  const provider = aiProviders[normalizeAiProviderId(providerId)];
  if (!provider) {
    throw new Error(`Unknown AI provider: ${providerId}`);
  }
  return provider;
}

export function getAiFeaturePolicy(feature: AiFeatureId): AiFeaturePolicy {
  return aiFeaturePolicies[feature];
}
