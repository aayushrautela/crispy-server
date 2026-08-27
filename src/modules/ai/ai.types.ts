import type { MetadataSearchResponse } from '../metadata/metadata-detail.types.js';
import type { ResponsiveImageSet } from '../metadata/metadata-card.types.js';
import type { MediaIdentity } from '../identity/media-key.js';
import type { TmdbTitleRecord } from '../metadata/providers/tmdb.types.js';

export type AiFeatureId = 'search' | 'insights';
export type AiCredentialSource = 'server';
export type ServerAiTier = 'pro' | 'ultra';

export type AiResolvedCandidate = {
  identity: MediaIdentity;
  contentId: string;
  hydrated: TmdbTitleRecord | null;
};

export type AiSearchInternalResult = {
  query: string;
  candidates: AiResolvedCandidate[];
};

export type AiResolvedProviderConfig = {
  id: string;
  label: string;
  endpointUrl: string;
  httpReferer: string;
  title: string;
};

export type AiProviderFailureKind =
  | 'network'
  | 'provider_response'
  | 'invalid_response'
  | 'unexpected_tool_calls';

export type AiProviderFailureDetails = {
  provider: string;
  providerStatus?: number;
  responseBody?: string;
  providerErrorCode?: string;
  providerErrorParam?: string;
  retryAfterSeconds?: number;
  failureKind?: AiProviderFailureKind;
  errorMessage?: string;
  toolCallNames?: string[];
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

export type AiInsightStandoutTag =
  | 'PERFORMANCE'
  | 'VISUALS'
  | 'STORY'
  | 'DIRECTION'
  | 'WORLD_BUILDING';

export type AiInsightStandoutElement = {
  tag: AiInsightStandoutTag;
  focus: string;
  context: string;
};

export type AiInsightSlideKey =
  | 'the_good_stuff'
  | 'the_catch'
  | 'standout_element'
  | 'trivia';

export type AiInsightSlideKind = 'prose' | 'standout' | 'trivia';

export type AiInsightSlide = {
  key: AiInsightSlideKey;
  label: string;
  kind: AiInsightSlideKind;
  body: string | null;
  tag: AiInsightStandoutTag | null;
  focus: string | null;
  context: string | null;
  backdrop: ResponsiveImageSet;
  accent: string;
};

export type AiInsightsResponse = {
  slides: AiInsightSlide[];
};

export type AiInsightsPayload = {
  the_good_stuff: string | null;
  the_catch: string | null;
  standout_element: AiInsightStandoutElement;
  trivia: string;
};
