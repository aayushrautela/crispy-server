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

export type AiSearchFilter = 'all' | 'movies' | 'series';

export type AiCandidateMediaType = 'movie' | 'tv';

export type AiSearchItem = {
  id: number;
  mediaType: AiCandidateMediaType;
  title: string;
  year: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: string | null;
  overview: string | null;
};

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

export type AiInsightsMediaType = 'movie' | 'tv';
