import {
  AI_INSIGHT_SLIDE_KEYS,
  type AiInsightSection,
  type AiInsightSlideKey,
  type AiInsightsPayload,
} from './ai.types.js';

export const AI_INSIGHTS_SCHEMA_NAME = 'ai_insights';

/** Headings longer than this are a wrong answer, not a card. */
const MAX_HEADING_LENGTH = 80;

/**
 * The schema the provider is asked to honour (structured outputs). It is the
 * same contract the parser below enforces locally, so a provider that ignores
 * the schema is caught by the parser rather than by the client apps.
 *
 * Strict-mode safe: every field is required and `additionalProperties` is
 * false. Optional sections are expressed by omitting the array element, never
 * by a nullable or empty value.
 */
export const AI_INSIGHTS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['slides'],
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'heading', 'body'],
        properties: {
          key: { type: 'string', enum: [...AI_INSIGHT_SLIDE_KEYS] },
          heading: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
};

export function isAiInsightSlideKey(value: unknown): value is AiInsightSlideKey {
  return typeof value === 'string' && (AI_INSIGHT_SLIDE_KEYS as readonly string[]).includes(value);
}

/**
 * Strict parse of the model's answer. Nothing is salvaged: a flat string, a
 * missing heading, an unknown key — all of it is a wrong answer, and the
 * caller retries instead of shipping fallback copy as if it were generated.
 *
 * The story needs a hook (`standout_element`), a fun fact (`trivia`) and at
 * least one review section (`the_good_stuff` or `the_catch`); a section the
 * model had nothing to say about is omitted from the array, not emptied.
 */
export function parseAiInsightsPayload(value: unknown): AiInsightsPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawSlides = value.slides;
  if (!Array.isArray(rawSlides) || rawSlides.length === 0) {
    return null;
  }

  const slides: AiInsightSection[] = [];
  const seen = new Set<AiInsightSlideKey>();
  for (const entry of rawSlides) {
    if (!isRecord(entry)) {
      return null;
    }

    const { key, heading, body } = entry;
    if (!isAiInsightSlideKey(key) || typeof heading !== 'string' || typeof body !== 'string') {
      return null;
    }

    const trimmedHeading = heading.trim();
    const trimmedBody = body.trim();
    if (!trimmedHeading || trimmedHeading.length > MAX_HEADING_LENGTH || !trimmedBody) {
      return null;
    }
    if (seen.has(key)) {
      // The first slide for a key wins; a duplicate is ignored.
      continue;
    }

    seen.add(key);
    slides.push({ key, heading: trimmedHeading, body: trimmedBody });
  }

  if (!seen.has('standout_element') || !seen.has('trivia')) {
    return null;
  }
  if (!seen.has('the_good_stuff') && !seen.has('the_catch')) {
    return null;
  }

  return { slides };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
