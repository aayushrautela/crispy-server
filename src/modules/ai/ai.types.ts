import type { MetadataSearchResponse } from '../metadata/metadata-detail.types.js';

export type AiFeatureId = 'recommendations' | 'search' | 'insights';
export type AiCredentialSource = 'user' | 'server';
export type ServerAiTier = 'pro' | 'ultra';

export type AiProviderView = {
  id: string;
  label: string;
  models?: Record<AiFeatureId, string>;
};

export type AiResolvedProviderConfig = {
  id: string;
  label: string;
  endpointUrl: string;
  httpReferer: string;
  title: string;
};

export type AiProviderFailureKind = 'network' | 'provider_response' | 'invalid_response';

export type AiProviderFailureDetails = {
  provider: string;
  providerStatus?: number;
  responseBody?: string;
  providerErrorCode?: string;
  providerErrorParam?: string;
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

export type AiSearchResponse = MetadataSearchResponse;

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
