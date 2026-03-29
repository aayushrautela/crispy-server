import type { MetadataCardView } from '../metadata/metadata.types.js';

export type AiFeatureId = 'search' | 'insights';

export type AiCredentialSource = 'user' | 'server' | 'shared_pool';

export type AiProviderView = {
  id: string;
  label: string;
  endpointUrl: string;
};

export type AiResolvedProviderConfig = AiProviderView & {
  httpReferer: string;
  title: string;
};

export type AiProviderFailureKind = 'network' | 'provider_response' | 'invalid_response';

export type AiProviderFailureDetails = {
  provider: string;
  providerStatus?: number;
  responseBody?: string;
  providerErrorCode?: string;
  retryAfterSeconds?: number;
  failureKind?: AiProviderFailureKind;
  errorMessage?: string;
};

export type AiClientSettings = {
  hasAiApiKey: boolean;
  providerId: string;
  defaultProviderId: string;
  providers: AiProviderView[];
};

export type AiApiKeyCandidate = {
  providerId: string;
  apiKey: string;
};

export type AiApiKeyLookup = {
  ownKeys: AiApiKeyCandidate[];
  pooledKeys: AiApiKeyCandidate[];
};

export type ResolvedAiRequest = {
  feature: AiFeatureId;
  providerId: string;
  provider: AiResolvedProviderConfig;
  model: string;
  apiKey: string;
  credentialSource: AiCredentialSource;
};

export type AiExecutionResult = {
  request: ResolvedAiRequest;
  payload: Record<string, unknown>;
};

export type AiSearchFilter = 'all' | 'movies' | 'series' | 'anime';

export type AiSearchItem = MetadataCardView;

export type AiSearchResponse = {
  items: AiSearchItem[];
};

export type AiInsightCard = {
  category: string;
  title: string;
  content: string;
  type: string;
};

export type AiInsightsPayload = {
  insights: AiInsightCard[];
  trivia: string;
};
