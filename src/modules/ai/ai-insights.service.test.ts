import assert from 'node:assert/strict';
import test from 'node:test';
import { NOOP_TRANSACTION, createMockMetadataView, seedTestEnv } from '../../test-helpers.js';

test('AiInsightsService loads reviews from MetadataReviewsService and bumps cache generation version', async () => {
  seedTestEnv();
  const { AiInsightsService } = await import('./ai-insights.service.js');

  let capturedPrompt = '';
  let capturedGenerationVersion = '';
  let capturedContentId = '';
  let ensuredMediaKey = '';

  const service = new AiInsightsService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    {
      findByKey: async () => null,
      upsert: async (_client: unknown, params: { contentId: string; generationVersion: string; payload: { insights: Array<Record<string, unknown>>; trivia: string } }) => {
        capturedContentId = params.contentId;
        capturedGenerationVersion = params.generationVersion;
        return params.payload;
      },
    } as never,
    {
      ensureContentId: async (_client: unknown, identity: { mediaKey: string }) => {
        ensuredMediaKey = identity.mediaKey;
        return '11111111-1111-4111-8111-111111111111';
      },
    } as never,
    {
      resolveAiRequestForUser: async () => ({
        providerId: 'openai',
        model: 'gpt-4.1-mini',
        provider: { id: 'openai', label: 'OpenAI', endpointUrl: 'https://example.com', httpReferer: 'https://example.com', title: 'OpenAI' },
        apiKey: 'key',
        feature: 'insights',
        credentialSource: 'server',
      }),
    } as never,
    {
      generateJsonForUser: async (input: { userPrompt: string }) => {
        const { userPrompt } = input;
        capturedPrompt = userPrompt;
        return {
          request: {
            providerId: 'openai',
            model: 'gpt-4.1-mini',
          },
          payload: {
            insights: [{ type: 'vibe', title: 'Hook', category: 'VIBE', content: 'Feels tense and focused.' }],
            trivia: 'Did you know?',
          },
        };
      },
    } as never,
    {
      getTitleDetailById: async () => ({
        item: createMockMetadataView({ mediaKey: 'movie:tmdb:1', title: 'The Movie', overview: 'A good film.', releaseYear: 2024, rating: 7.3, genres: ['Drama'] }),
        seasons: [],
        videos: [],
        cast: [],
        directors: [],
        creators: [],
        production: { originalLanguage: 'en', originCountries: [], spokenLanguages: [], productionCountries: [], companies: [], networks: [] },
        collection: null,
        similar: [],
      }),
    } as never,
    {
      getTitleReviews: async () => ({
        reviews: [{ id: 'r1', author: 'Critic', username: 'critic', content: 'Great pacing and payoff.', createdAt: null, updatedAt: null, url: null, rating: 9, avatarUrl: null }],
      }),
    } as never,
    NOOP_TRANSACTION,
  );

  const payload = await service.getInsights('user-1', {
    mediaKey: 'movie:tmdb:1',
    profileId: 'profile-1',
    locale: 'en-US',
  });

  assert.equal(payload.insights.length, 1);
  assert.equal(ensuredMediaKey, 'movie:tmdb:1');
  assert.equal(capturedContentId, '11111111-1111-4111-8111-111111111111');
  assert.match(capturedPrompt, /Great pacing and payoff\./);
  assert.match(capturedGenerationVersion, /^v4:/);
});
