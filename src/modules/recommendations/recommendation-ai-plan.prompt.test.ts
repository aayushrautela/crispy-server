import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildRecommendationAiPlanPrompt } from './recommendation-ai-plan.prompt.js';
import type { RecommendationAiPlanRequest } from './recommendation-ai-plan.types.js';

describe('recommendation-ai-plan.prompt', () => {
  const request: RecommendationAiPlanRequest = {
    schemaVersion: 1,
    requestId: 'req-123',
    runId: 'run-123',
    listKey: 'for-you',
    intent: 'generate_recommendation_plan',
    locale: 'en-US',
    timezone: 'America/New_York',
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
      watchHistory: [
        {
          itemId: '00000000000000000000000000000550',
          title: 'Fight Club',
          mediaType: 'movie',
          provider: 'tmdb',
          providerId: '550',
          year: 1999,
          overview: 'An insomniac office worker forms an underground fight club.',
        },
      ],
      ratings: [],
      watchlist: [],
      negativeSignals: [],
    },
    candidatePool: [
      {
        itemId: '00000000000000000000000000000603',
        title: 'The Matrix',
        mediaType: 'movie',
        provider: 'tmdb',
        providerId: '603',
        year: 1999,
        overview: 'A hacker discovers the nature of reality.',
        genres: ['Action', 'Science Fiction'],
        popularity: 83.4,
      },
    ],
  };

  it('should build system and user prompts', () => {
    const result = buildRecommendationAiPlanPrompt(request);
    assert.ok(result.systemPrompt);
    assert.ok(result.userPrompt);
  });

  it('should include candidate pool', () => {
    const result = buildRecommendationAiPlanPrompt(request);
    assert.ok(result.userPrompt.includes('CANDIDATE POOL'));
    assert.ok(result.userPrompt.includes('The Matrix'));
    assert.ok(result.userPrompt.includes('00000000000000000000000000000603'));
  });

  it('should include constraints', () => {
    const result = buildRecommendationAiPlanPrompt(request);
    assert.ok(result.systemPrompt.includes('20'));
    assert.ok(result.systemPrompt.includes('0.1'));
    assert.ok(result.userPrompt.includes('Max items: 20'));
    assert.ok(result.userPrompt.includes('Media types: movie, show'));
  });

  it('should instruct JSON only', () => {
    const result = buildRecommendationAiPlanPrompt(request);
    assert.ok(result.systemPrompt.includes('Output ONLY valid JSON'));
    assert.ok(result.systemPrompt.includes('OUTPUT SCHEMA'));
  });

  it('should instruct candidate-only selection', () => {
    const result = buildRecommendationAiPlanPrompt(request);
    assert.ok(result.systemPrompt.includes('MUST ONLY select items from the candidate pool'));
    assert.ok(result.userPrompt.includes('SELECT ONLY FROM THESE'));
  });

  it('should include safety/maturity instructions', () => {
    const result = buildRecommendationAiPlanPrompt(request);
    assert.ok(result.systemPrompt.includes('PG-13'));
    assert.ok(result.systemPrompt.includes('en'));
    assert.ok(result.systemPrompt.includes('US'));
  });

  it('should not include credentials or config-bundle concepts', () => {
    const result = buildRecommendationAiPlanPrompt(request);
    const combined = `${result.systemPrompt}\n${result.userPrompt}`;
    assert.ok(!combined.includes('apiKey'));
    assert.ok(!combined.includes('secretDelivery'));
    assert.ok(!combined.includes('configBundle'));
    assert.ok(!combined.includes('proxyEndpoint'));
    assert.ok(!combined.includes('endpointUrl'));
  });
});
