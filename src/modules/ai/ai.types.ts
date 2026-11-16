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

/** A JSON Schema the provider is asked to honour for a structured call. */
export type AiJsonSchemaSpec = {
  name: string;
  schema: Record<string, unknown>;
};

export type AiSearchResponse = MetadataSearchResponse;

/**
 * The slide keys the model may return, in the order the story shows them:
 * the hook first, then good/bad, the fun fact last. One list, so the schema,
 * the parser and the slide builder cannot drift apart.
 */
export const AI_INSIGHT_SLIDE_KEYS = ['standout_element', 'the_good_stuff', 'the_catch', 'trivia'] as const;

export type AiInsightSlideKey = (typeof AI_INSIGHT_SLIDE_KEYS)[number];

/**
 * One section of the model's answer: which slide it is, the headline and the
 * copy under it. The heading is required — a section without one is a wrong
 * answer, not a slide to be filled in with a generic label later.
 */
export type AiInsightSection = {
  key: AiInsightSlideKey;
  heading: string;
  body: string;
};

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
  slides: AiInsightSection[];
};
