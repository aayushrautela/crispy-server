import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateAiPlanOutput } from './recommendation-ai-plan.output-schema.js';
import { HttpError } from '../../lib/errors.js';
import type { RecommendationAiPlanCandidate } from './recommendation-ai-plan.types.js';

describe('recommendation-ai-plan.output-schema', () => {
  const candidatePool: RecommendationAiPlanCandidate[] = [
    {
      type: 'movie',
      providerRefs: [{ provider: 'tmdb', providerId: '603' }],
      title: 'The Matrix',
      year: 1999,
    },
    {
      type: 'movie',
      providerRefs: [{ provider: 'tmdb', providerId: '550' }],
      title: 'Fight Club',
      year: 1999,
    },
  ];

  const validOutput = {
    summary: 'Prioritize high-confidence sci-fi titles.',
    items: [
      {
        type: 'movie',
        provider: 'tmdb',
        providerId: '603',
        score: 0.94,
        confidence: 0.88,
        reason: 'Matches high-concept sci-fi preferences.',
        reasonCodes: ['genre_match'],
      },
    ],
  };

  describe('validateAiPlanOutput', () => {
    it('should accept valid output', () => {
      const result = validateAiPlanOutput(validOutput, candidatePool, 20);
      assert.strictEqual(result.summary, validOutput.summary);
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0]?.providerId, '603');
    });

    it('should reject non-object output', () => {
      assert.throws(
        () => validateAiPlanOutput(null, candidatePool, 20),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_INVALID_VENDOR_OUTPUT';
        },
      );
    });

    it('should reject output without summary', () => {
      const invalid = { ...validOutput, summary: '' };
      assert.throws(
        () => validateAiPlanOutput(invalid, candidatePool, 20),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED';
        },
      );
    });

    it('should reject output without items array', () => {
      const invalid = { ...validOutput, items: 'not-an-array' };
      assert.throws(
        () => validateAiPlanOutput(invalid, candidatePool, 20),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED';
        },
      );
    });

    it('should reject output exceeding maxItems', () => {
      const invalid = {
        summary: 'Test',
        items: [
          { ...validOutput.items[0], providerId: '603' },
          { ...validOutput.items[0], providerId: '550' },
        ],
      };
      assert.throws(
        () => validateAiPlanOutput(invalid, candidatePool, 1),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED' && err.message.includes('maxItems');
        },
      );
    });

    it('should reject provider ref not in candidate pool', () => {
      const invalid = {
        summary: 'Test',
        items: [
          {
            type: 'movie',
            provider: 'tmdb',
            providerId: '999',
            score: 0.9,
            confidence: 0.8,
            reason: 'Test',
            reasonCodes: ['test'],
          },
        ],
      };
      assert.throws(
        () => validateAiPlanOutput(invalid, candidatePool, 20),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED' && err.message.includes('not in candidate pool');
        },
      );
    });

    it('should reject duplicate provider ref', () => {
      const invalid = {
        summary: 'Test',
        items: [
          { ...validOutput.items[0] },
          { ...validOutput.items[0] },
        ],
      };
      assert.throws(
        () => validateAiPlanOutput(invalid, candidatePool, 20),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED' && err.message.includes('duplicate');
        },
      );
    });

    it('should reject invalid score', () => {
      const invalid = {
        summary: 'Test',
        items: [{ ...validOutput.items[0], score: 1.5 }],
      };
      assert.throws(
        () => validateAiPlanOutput(invalid, candidatePool, 20),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED' && err.message.includes('score');
        },
      );
    });

    it('should reject invalid confidence', () => {
      const invalid = {
        summary: 'Test',
        items: [{ ...validOutput.items[0], confidence: -0.1 }],
      };
      assert.throws(
        () => validateAiPlanOutput(invalid, candidatePool, 20),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED' && err.message.includes('confidence');
        },
      );
    });

    it('should reject missing reason', () => {
      const invalid = {
        summary: 'Test',
        items: [{ ...validOutput.items[0], reason: '' }],
      };
      assert.throws(
        () => validateAiPlanOutput(invalid, candidatePool, 20),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED' && err.message.includes('reason');
        },
      );
    });

    it('should reject non-array reasonCodes', () => {
      const invalid = {
        summary: 'Test',
        items: [{ ...validOutput.items[0], reasonCodes: 'not-array' }],
      };
      assert.throws(
        () => validateAiPlanOutput(invalid, candidatePool, 20),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED' && err.message.includes('reasonCodes');
        },
      );
    });
  });
});
