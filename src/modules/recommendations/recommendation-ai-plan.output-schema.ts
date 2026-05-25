import { HttpError } from '../../lib/errors.js';
import type { RecommendationAiPlanCandidate } from './recommendation-ai-plan.types.js';
import type { RecoMediaType, RecoProvider } from './reco-contract.types.js';

export type AiPlanRawOutput = {
  summary: string;
  items: Array<{
    type: RecoMediaType;
    provider: RecoProvider;
    providerId: string;
    score: number;
    confidence: number;
    reason: string;
    reasonCodes: string[];
  }>;
};

export function validateAiPlanOutput(
  output: unknown,
  candidatePool: RecommendationAiPlanCandidate[],
  maxItems: number,
): AiPlanRawOutput {
  if (!output || typeof output !== 'object') {
    throw new HttpError(502, 'AI output must be a JSON object', {
      code: 'AI_PLAN_INVALID_VENDOR_OUTPUT',
      retryable: true,
    });
  }

  const obj = output as Record<string, unknown>;

  if (typeof obj.summary !== 'string' || obj.summary.trim().length === 0) {
    throw new HttpError(502, 'AI output missing valid summary', {
      code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
      retryable: true,
    });
  }

  if (!Array.isArray(obj.items)) {
    throw new HttpError(502, 'AI output items must be an array', {
      code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
      retryable: true,
    });
  }

  if (obj.items.length > maxItems) {
    throw new HttpError(502, `AI output exceeds maxItems constraint: ${obj.items.length} > ${maxItems}`, {
      code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
      retryable: true,
    });
  }

  const candidateKeys = new Set<string>();
  for (const candidate of candidatePool) {
    for (const ref of candidate.providerRefs) {
      candidateKeys.add(providerKey(candidate.type, ref.provider, ref.providerId));
    }
  }

  const seenKeys = new Set<string>();
  const validatedItems: AiPlanRawOutput['items'] = [];

  for (let i = 0; i < obj.items.length; i++) {
    const item = obj.items[i];

    if (!item || typeof item !== 'object') {
      throw new HttpError(502, `AI output item ${i} is not an object`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    const itemObj = item as Record<string, unknown>;

    if (itemObj.type !== 'movie' && itemObj.type !== 'tv') {
      throw new HttpError(502, `AI output item ${i} missing valid type`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    if (itemObj.provider !== 'tmdb' && itemObj.provider !== 'tvdb' && itemObj.provider !== 'imdb' && itemObj.provider !== 'kitsu') {
      throw new HttpError(502, `AI output item ${i} missing valid provider`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    if (typeof itemObj.providerId !== 'string' || !itemObj.providerId.trim()) {
      throw new HttpError(502, `AI output item ${i} missing valid providerId`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    const key = providerKey(itemObj.type, itemObj.provider, itemObj.providerId);
    if (seenKeys.has(key)) {
      throw new HttpError(502, `AI output contains duplicate provider ref: ${key}`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }
    seenKeys.add(key);

    if (!candidateKeys.has(key)) {
      throw new HttpError(502, `AI output provider ref not in candidate pool: ${key}`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    if (typeof itemObj.score !== 'number' || itemObj.score < 0 || itemObj.score > 1) {
      throw new HttpError(502, `AI output item ${i} has invalid score: ${itemObj.score}`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    if (typeof itemObj.confidence !== 'number' || itemObj.confidence < 0 || itemObj.confidence > 1) {
      throw new HttpError(502, `AI output item ${i} has invalid confidence: ${itemObj.confidence}`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    if (typeof itemObj.reason !== 'string' || itemObj.reason.trim().length === 0) {
      throw new HttpError(502, `AI output item ${i} missing valid reason`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    if (!Array.isArray(itemObj.reasonCodes)) {
      throw new HttpError(502, `AI output item ${i} reasonCodes must be an array`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    for (const code of itemObj.reasonCodes) {
      if (typeof code !== 'string') {
        throw new HttpError(502, `AI output item ${i} reasonCodes must be strings`, {
          code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
          retryable: true,
        });
      }
    }

    validatedItems.push({
      type: itemObj.type,
      provider: itemObj.provider,
      providerId: itemObj.providerId.trim(),
      score: itemObj.score,
      confidence: itemObj.confidence,
      reason: itemObj.reason,
      reasonCodes: itemObj.reasonCodes as string[],
    });
  }

  return {
    summary: obj.summary,
    items: validatedItems,
  };
}

export function providerKey(type: RecoMediaType, provider: RecoProvider | string, providerId: string): string {
  return `${type}:${provider}:${providerId.trim()}`;
}
