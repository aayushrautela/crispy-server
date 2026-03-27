import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('server fallback blocks models with transient and rate-limit cooldowns', async () => {
  const state = await import('./ai-server-fallback-state.js');

  state.resetServerFallbackState();
  const now = 1_000;

  assert.deepEqual(state.getHealthyServerModels(['gpt-4o-mini', 'gpt-4.1-mini'], 'openai', now), ['gpt-4o-mini', 'gpt-4.1-mini']);

  state.recordServerModelTransientFailure('openai', 'gpt-4o-mini', now);
  assert.deepEqual(state.getHealthyServerModels(['gpt-4o-mini', 'gpt-4.1-mini'], 'openai', now), ['gpt-4.1-mini']);
  assert.equal(state.isServerModelBlocked('openai', 'gpt-4o-mini', now + 29_000), true);
  assert.equal(state.isServerModelBlocked('openai', 'gpt-4o-mini', now + 31_000), false);

  state.recordServerModelRateLimit('openai', 'gpt-4o-mini', undefined, now + 31_000);
  assert.equal(state.isServerModelBlocked('openai', 'gpt-4o-mini', now + 100_000), true);
  assert.equal(state.isServerModelBlocked('openai', 'gpt-4o-mini', now + 160_000), false);
});

test('server fallback can block whole provider', async () => {
  const state = await import('./ai-server-fallback-state.js');

  state.resetServerFallbackState();
  const now = 5_000;

  state.blockServerProvider('openai', now);
  assert.equal(state.isServerProviderBlocked('openai', now + 1_000), true);
  state.clearServerProviderBlock('openai');
  assert.equal(state.isServerProviderBlocked('openai', now + 1_000), false);
});
