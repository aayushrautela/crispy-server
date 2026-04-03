import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('resolver skips blocked server model and picks next configured model', async () => {
  const { AiProviderResolver } = await import('./ai-provider-resolver.js');
  const state = await import('./ai-server-fallback-state.js');

  state.resetServerFallbackState();
  state.recordServerModelRateLimit('openai', 'gpt-4o-mini', 120, Date.now());

  const resolver = new AiProviderResolver({
    getAiProviderIdForUser: async () => 'openrouter',
    listAiApiKeysForLookup: async () => ({
      ownKeys: [],
      pooledKeys: [{ providerId: 'openrouter', apiKey: 'pool-openrouter-key' }],
    }),
  } as never, [{ providerId: 'openai', apiKey: 'server-openai-key' }]);

  const result = await resolver.resolveForUser('user-1', 'search');
  assert.equal(result.providerId, 'openai');
  assert.equal(result.apiKey, 'server-openai-key');
  assert.equal(result.credentialSource, 'server');
  assert.equal(result.model, 'gpt-4.1-mini');
});

test('resolver prefers user key for selected provider', async () => {
  const { AiProviderResolver } = await import('./ai-provider-resolver.js');

  const resolver = new AiProviderResolver({
    getAiProviderIdForUser: async () => 'openrouter',
    listAiApiKeysForLookup: async () => ({
      ownKeys: [{ providerId: 'openrouter', apiKey: 'user-openrouter-key' }],
      pooledKeys: [{ providerId: 'openrouter', apiKey: 'pool-openrouter-key' }],
    }),
  } as never, [{ providerId: 'openai', apiKey: 'server-openai-key' }]);

  const result = await resolver.resolveForUser('user-1', 'search');
  assert.equal(result.providerId, 'openrouter');
  assert.equal(result.apiKey, 'user-openrouter-key');
  assert.equal(result.credentialSource, 'user');
  assert.equal(result.model, 'openai/gpt-4o-mini');
});

test('resolver falls back to server key when user key is missing', async () => {
  const { AiProviderResolver } = await import('./ai-provider-resolver.js');

  const resolver = new AiProviderResolver({
    getAiProviderIdForUser: async () => 'openrouter',
    listAiApiKeysForLookup: async () => ({
      ownKeys: [],
      pooledKeys: [{ providerId: 'openrouter', apiKey: 'pool-openrouter-key' }],
    }),
  } as never, [{ providerId: 'openai', apiKey: 'server-openai-key' }]);

  const result = await resolver.resolveForUser('user-1', 'insights');
  assert.equal(result.providerId, 'openai');
  assert.equal(result.apiKey, 'server-openai-key');
  assert.equal(result.credentialSource, 'server');
  assert.equal(result.model, 'gpt-4.1-mini');
});

test('resolver falls back to pooled key when server key is unavailable', async () => {
  const { AiProviderResolver } = await import('./ai-provider-resolver.js');

  const resolver = new AiProviderResolver({
    getAiProviderIdForUser: async () => 'openrouter',
    listAiApiKeysForLookup: async () => ({
      ownKeys: [],
      pooledKeys: [{ providerId: 'openrouter', apiKey: 'pool-openrouter-key' }],
    }),
  } as never, []);

  const result = await resolver.resolveForUser('user-1', 'search');
  assert.equal(result.providerId, 'openrouter');
  assert.equal(result.apiKey, 'pool-openrouter-key');
  assert.equal(result.credentialSource, 'shared_pool');
});
