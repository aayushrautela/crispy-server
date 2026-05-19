import { HttpError } from '../../lib/errors.js';
import type { RecommendationAiPlanCandidate } from './recommendation-ai-plan.types.js';

export type AiPlanRawOutput = {
  summary: string;
  items: Array<{
    itemId: string;
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

  const candidateMap = new Map<string, RecommendationAiPlanCandidate>();
  for (const candidate of candidatePool) {
    candidateMap.set(candidate.itemId, candidate);
  }

  const seenItemIds = new Set<string>();
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

    if (typeof itemObj.itemId !== 'string' || !itemObj.itemId) {
      throw new HttpError(502, `AI output item ${i} missing valid itemId`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }

    if (seenItemIds.has(itemObj.itemId)) {
      throw new HttpError(502, `AI output contains duplicate itemId: ${itemObj.itemId}`, {
        code: 'AI_PLAN_OUTPUT_VALIDATION_FAILED',
        retryable: true,
      });
    }
    seenItemIds.add(itemObj.itemId);

    if (!candidateMap.has(itemObj.itemId)) {
      throw new HttpError(502, `AI output itemId not in candidate pool: ${itemObj.itemId}`, {
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
      itemId: itemObj.itemId,
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
