import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('credential resolver blocks free tier AI without requiring a key', async () => {
  const { AiCredentialResolver } = await import('./ai-credential-resolver.service.js');

  const resolver = new AiCredentialResolver({
    getPricingTierForUser: () => 'free',
    getAiProviderIdForUser: async () => 'openrouter',
  } as never, []);

  await assert.rejects(
    () => resolver.resolveForTask('user-1', 'search'),
    /not available on the free tier/,
  );
});

test('credential resolver uses lite user OpenRouter BYOK', async () => {
  const { AiCredentialResolver } = await import('./ai-credential-resolver.service.js');

  const resolver = new AiCredentialResolver({
    getPricingTierForUser: () => 'lite',
    getAiProviderIdForUser: async () => 'openrouter',
    getAiApiKeyForUser: async () => ({ appUserId: 'user-1', key: 'ai.api_key', value: 'user-openrouter-key' }),
  } as never, []);

  const result = await resolver.resolveForTask('user-1', 'recommendations');
  assert.equal(result.feature, 'recommendations');
  assert.equal(result.providerId, 'openrouter');
  assert.equal(result.apiKey, 'user-openrouter-key');
  assert.equal(result.credentialSource, 'user');
  assert.equal(result.model, 'openai/gpt-4o-mini');
});

test('credential resolver uses pro server key and pro model', async () => {
  const { AiCredentialResolver } = await import('./ai-credential-resolver.service.js');

  const resolver = new AiCredentialResolver({
    getPricingTierForUser: () => 'pro',
    getAiProviderIdForUser: async () => 'openrouter',
  } as never, [{ apiKey: 'server-ai-key' }]);

  const result = await resolver.resolveForTask('user-1', 'insights');
  assert.equal(result.feature, 'insights');
  assert.equal(result.providerId, 'server-ai');
  assert.equal(result.apiKey, 'server-ai-key');
  assert.equal(result.credentialSource, 'server');
  assert.equal(result.model, 'provider/pro-model');
});

test('credential resolver does not fall back to pooled keys', async () => {
  const { AiCredentialResolver } = await import('./ai-credential-resolver.service.js');

  const resolver = new AiCredentialResolver({
    getPricingTierForUser: () => 'lite',
    getAiProviderIdForUser: async () => 'openrouter',
    getAiApiKeyForUser: async () => {
      const { HttpError } = await import('../../lib/errors.js');
      throw new HttpError(404, 'Account secret not found.');
    },
  } as never, [{ providerId: 'openrouter', apiKey: 'server-openrouter-key' }]);

  await assert.rejects(
    () => resolver.resolveForTask('user-1', 'search'),
    /requires an API key/,
  );
});
