import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateAiPlanRequest, validatePathBodyMatch } from './recommendation-ai-plan.validation.js';
import { HttpError } from '../../lib/errors.js';
import type { RecommendationAiPlanRequest } from './recommendation-ai-plan.types.js';

describe('recommendation-ai-plan.validation', () => {
  const validRequest: RecommendationAiPlanRequest = {
    schemaVersion: 1,
    requestId: 'req-123',
    runId: 'run-123',
    listKey: 'for-you',
    intent: 'generate_recommendation_plan',
    locale: 'en-US',
    generatedAt: '2026-05-06T12:00:00.000Z',
    constraints: {
      maxItems: 20,
      mediaTypes: ['movie', 'show'],
      excludeWatched: true,
      excludeWatchlisted: false,
      minimumConfidence: 0.1,
    },
    profile: {
      accountId: 'acc_123',
      profileId: 'prof_456',
      displayName: 'Test User',
      maturityRating: 'PG-13',
      preferredLanguages: ['en'],
      country: 'US',
    },
    signals: {
      watchHistory: [],
      ratings: [],
      watchlist: [],
      negativeSignals: [],
    },
    candidatePool: [
      {
        mediaKey: 'movie:tmdb:603',
        title: 'The Matrix',
        mediaType: 'movie',
        provider: 'tmdb',
        providerId: '603',
        year: 1999,
      },
    ],
  };

  describe('validateAiPlanRequest', () => {
    it('should accept valid request', () => {
      assert.doesNotThrow(() => validateAiPlanRequest(validRequest));
    });

    it('should reject non-object body', () => {
      assert.throws(
        () => validateAiPlanRequest(null),
        (err: Error) => err instanceof HttpError && err.statusCode === 400,
      );
    });

    it('should reject unsupported schema version', () => {
      const invalid = { ...validRequest, schemaVersion: 2 };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return err.statusCode === 400 && details?.code === 'UNSUPPORTED_AI_PLAN_SCHEMA_VERSION';
        },
      );
    });

    it('should reject request with provider field', () => {
      const invalid = { ...validRequest, provider: 'openai' };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => err instanceof HttpError && err.message.includes('provider'),
      );
    });

    it('should reject request with model field', () => {
      const invalid = { ...validRequest, model: 'gpt-4' };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => err instanceof HttpError && err.message.includes('model'),
      );
    });

    it('should reject request with proxyEndpoint field', () => {
      const invalid = { ...validRequest, proxyEndpoint: 'https://proxy.example.com' };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => err instanceof HttpError && err.message.includes('proxyEndpoint'),
      );
    });

    it('should reject request with messages field', () => {
      const invalid = { ...validRequest, messages: [] };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => err instanceof HttpError && err.message.includes('messages'),
      );
    });

    it('should reject request with prompt field', () => {
      const invalid = { ...validRequest, prompt: 'some prompt' };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => err instanceof HttpError && err.message.includes('prompt'),
      );
    });

    it('should reject request with aiConfig field', () => {
      const invalid = { ...validRequest, aiConfig: {} };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => err instanceof HttpError && err.message.includes('aiConfig'),
      );
    });

    it('should reject request with empty candidatePool', () => {
      const invalid = { ...validRequest, candidatePool: [] };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => {
          if (!(err instanceof HttpError)) return false;
          const details = err.details as { code?: string } | undefined;
          return err.statusCode === 422 && details?.code === 'EMPTY_CANDIDATE_POOL';
        },
      );
    });

    it('should reject request with missing requestId', () => {
      const invalid = { ...validRequest, requestId: '' };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => err instanceof HttpError && err.statusCode === 400,
      );
    });

    it('should reject request with invalid intent', () => {
      const invalid = { ...validRequest, intent: 'wrong_intent' };
      assert.throws(
        () => validateAiPlanRequest(invalid),
        (err: Error) => err instanceof HttpError && err.message.includes('intent'),
      );
    });
  });

  describe('validatePathBodyMatch', () => {
    it('should accept matching path and body', () => {
      assert.doesNotThrow(() => validatePathBodyMatch('acc_123', 'prof_456', validRequest));
    });

    it('should reject mismatched accountId', () => {
      assert.throws(
        () => validatePathBodyMatch('acc_999', 'prof_456', validRequest),
        (err: Error) => err instanceof HttpError && err.message.includes('accountId'),
      );
    });

    it('should reject mismatched profileId', () => {
      assert.throws(
        () => validatePathBodyMatch('acc_123', 'prof_999', validRequest),
        (err: Error) => err instanceof HttpError && err.message.includes('profileId'),
      );
    });
  });
});
