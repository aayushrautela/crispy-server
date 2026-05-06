import { describe, it } from 'node:test';
import assert from 'node:assert';
import { setTestEnv } from '../../test-helpers.js';
import { HttpError } from '../../lib/errors.js';
import { RecommendationAiPlanService } from './recommendation-ai-plan.service.js';
import type { RecommendationAiPlanRequest } from './recommendation-ai-plan.types.js';
import type { AiExecutionResult } from '../ai/ai.types.js';

setTestEnv({
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  JWT_SECRET: 'test-jwt-secret',
  CRISPY_RECOMMENDER_API_TOKEN_HASH: 'unused-token-hash',
});

class FakeAiExecutor {
  constructor(private readonly result: AiExecutionResult | Error) {}

  async generateJsonForUser(): Promise<AiExecutionResult> {
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

describe('RecommendationAiPlanService', () => {
  const request: RecommendationAiPlanRequest = {
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
      {
        mediaKey: 'movie:tmdb:550',
        title: 'Fight Club',
        mediaType: 'movie',
        provider: 'tmdb',
        providerId: '550',
        year: 1999,
      },
    ],
  };

  const aiRequest = {
    feature: 'recommendations' as const,
    providerId: 'test-provider',
    provider: {
      id: 'test-provider',
      label: 'Test Provider',
      endpointUrl: 'https://example.com',
      httpReferer: 'https://example.com',
      title: 'Test',
    },
    model: 'test-model',
    apiKey: 'secret',
    credentialSource: 'server' as const,
  };

  it('should return typed plan for valid AI output', async () => {
    const executor = new FakeAiExecutor({
      request: aiRequest,
      payload: {
        summary: 'Prioritize sci-fi and action titles.',
        items: [
          {
            mediaKey: 'movie:tmdb:603',
            score: 0.94,
            confidence: 0.88,
            reason: 'Matches high-concept sci-fi preferences.',
            reasonCodes: ['genre_match'],
          },
        ],
      },
    });

    const service = new RecommendationAiPlanService(executor as never);
    const response = await service.generatePlan(request);

    assert.strictEqual(response.schemaVersion, 1);
    assert.strictEqual(response.requestId, 'req-123');
    assert.strictEqual(response.runId, 'run-123');
    assert.strictEqual(response.listKey, 'for-you');
    assert.strictEqual(response.plan.summary, 'Prioritize sci-fi and action titles.');
    assert.strictEqual(response.plan.items.length, 1);
    assert.strictEqual(response.plan.items[0]?.rank, 1);
    assert.strictEqual(response.plan.items[0]?.mediaKey, 'movie:tmdb:603');
    assert.strictEqual(response.plan.items[0]?.title, 'The Matrix');
    assert.strictEqual(response.plan.items[0]?.provider, 'tmdb');
    assert.strictEqual(response.plan.items[0]?.providerId, '603');
    assert.ok(response.diagnostics.latencyMs >= 0);
    assert.ok(response.diagnostics.aiPlanVersion);
  });

  it('should assign ranks server-side', async () => {
    const executor = new FakeAiExecutor({
      request: aiRequest,
      payload: {
        summary: 'Test summary',
        items: [
          {
            mediaKey: 'movie:tmdb:550',
            score: 0.9,
            confidence: 0.8,
            reason: 'Test reason 1',
            reasonCodes: ['genre_match'],
          },
          {
            mediaKey: 'movie:tmdb:603',
            score: 0.8,
            confidence: 0.7,
            reason: 'Test reason 2',
            reasonCodes: ['tone_match'],
          },
        ],
      },
    });

    const service = new RecommendationAiPlanService(executor as never);
    const response = await service.generatePlan(request);

    assert.strictEqual(response.plan.items[0]?.rank, 1);
    assert.strictEqual(response.plan.items[1]?.rank, 2);
  });

  it('should reject unknown media key', async () => {
    const executor = new FakeAiExecutor({
      request: aiRequest,
      payload: {
        summary: 'Test summary',
        items: [
          {
            mediaKey: 'movie:tmdb:999',
            score: 0.9,
            confidence: 0.8,
            reason: 'Test reason',
            reasonCodes: ['genre_match'],
          },
        ],
      },
    });

    const service = new RecommendationAiPlanService(executor as never);
    await assert.rejects(
      () => service.generatePlan(request),
      (err: Error) => {
        if (!(err instanceof HttpError)) return false;
        const details = err.details as { code?: string } | undefined;
        return details?.code === 'AI_PLAN_OUTPUT_VALIDATION_FAILED';
      },
    );
  });

  it('should map timeout to AI_PLAN_TIMEOUT', async () => {
    const executor = new FakeAiExecutor(new HttpError(504, 'Timeout'));
    const service = new RecommendationAiPlanService(executor as never);

    await assert.rejects(
      () => service.generatePlan(request),
      (err: Error) => {
        if (!(err instanceof HttpError)) return false;
        const details = err.details as { code?: string } | undefined;
        return err.statusCode === 504 && details?.code === 'AI_PLAN_TIMEOUT';
      },
    );
  });

  it('should map rate limit to AI_PLAN_RATE_LIMITED', async () => {
    const executor = new FakeAiExecutor(new HttpError(429, 'Rate limited'));
    const service = new RecommendationAiPlanService(executor as never);

    await assert.rejects(
      () => service.generatePlan(request),
      (err: Error) => {
        if (!(err instanceof HttpError)) return false;
        const details = err.details as { code?: string } | undefined;
        return err.statusCode === 429 && details?.code === 'AI_PLAN_RATE_LIMITED';
      },
    );
  });

  it('should map provider unavailable to AI_PLAN_PROVIDER_UNAVAILABLE', async () => {
    const executor = new FakeAiExecutor(new HttpError(503, 'Unavailable'));
    const service = new RecommendationAiPlanService(executor as never);

    await assert.rejects(
      () => service.generatePlan(request),
      (err: Error) => {
        if (!(err instanceof HttpError)) return false;
        const details = err.details as { code?: string } | undefined;
        return err.statusCode === 502 && details?.code === 'AI_PLAN_PROVIDER_UNAVAILABLE';
      },
    );
  });
});
