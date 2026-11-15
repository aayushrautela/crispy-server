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
  locale: string;
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

/**
 * One insight section: a short heading and the copy under it. `heading` is
 * optional because the model may omit it; the slide builder falls back to a
 * default for each section.
 */
export type AiInsightSection = {
  heading: string | null;
  text: string;
};

export type AiInsightSlideKey =
  | 'the_good_stuff'
  | 'the_catch'
  | 'standout_element'
  | 'trivia';

export type AiInsightSlideKind = 'prose' | 'standout' | 'trivia';

/**
 * Every slide has the same shape — heading, paragraph — so the client apps
 * render one card component instead of branching on the slide kind.
 */
export type AiInsightSlide = {
  key: AiInsightSlideKey;
  label: string;
  kind: AiInsightSlideKind;
  heading: string;
  body: string;
  backdrop: ResponsiveImageSet;
  accent: string;
};

export type AiInsightsResponse = {
  slides: AiInsightSlide[];
};

export type AiInsightsPayload = {
  the_good_stuff: AiInsightSection | null;
  the_catch: AiInsightSection | null;
  standout_element: AiInsightSection;
  trivia: AiInsightSection;
};
