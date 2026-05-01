import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('resolver delegates to deterministic lite BYOK task resolution', async () => {
  const { AiProviderResolver } = await import('./ai-provider-resolver.js');

  const resolver = new AiProviderResolver({
    getPricingTierForUser: () => 'lite',
    getAiProviderIdForUser: async () => 'openrouter',
    getAiApiKeyForUser: async () => ({ appUserId: 'user-1', key: 'ai.api_key', value: 'user-openrouter-key' }),
  } as never, '');

  const result = await resolver.resolveForUser('user-1', 'search');
  assert.equal(result.providerId, 'openrouter');
  assert.equal(result.apiKey, 'user-openrouter-key');
  assert.equal(result.credentialSource, 'user');
  assert.equal(result.model, 'openai/gpt-4o-mini');
});

test('resolver does not fall back to server or pooled keys for lite without BYOK', async () => {
  const { AiProviderResolver } = await import('./ai-provider-resolver.js');
  const { HttpError } = await import('../../lib/errors.js');

  const resolver = new AiProviderResolver({
    getPricingTierForUser: () => 'lite',
    getAiProviderIdForUser: async () => 'openrouter',
    getAiApiKeyForUser: async () => {
      throw new HttpError(404, 'Account secret not found.');
    },
  } as never, 'server-ai-key');

  await assert.rejects(
    () => resolver.resolveForUser('user-1', 'search'),
    /requires an API key/,
  );
});

test('resolver uses server env key for pro', async () => {
  const { AiProviderResolver } = await import('./ai-provider-resolver.js');

  const resolver = new AiProviderResolver({
    getPricingTierForUser: () => 'pro',
    getAiProviderIdForUser: async () => 'openrouter',
  } as never, 'server-ai-key');

  const result = await resolver.resolveForUser('user-1', 'insights');
  assert.equal(result.providerId, 'server-ai');
  assert.equal(result.apiKey, 'server-ai-key');
  assert.equal(result.credentialSource, 'server');
  assert.equal(result.model, 'provider/pro-model');
});
