import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('request executor retries server models after rate limit', async () => {
  const { AiRequestExecutor } = await import('./ai-request-executor.js');
  const state = await import('./ai-server-fallback-state.js');

  state.resetServerFallbackState();

  const requests = [
    {
      feature: 'search',
      providerId: 'openai',
      provider: { id: 'openai', label: 'OpenAI', endpointUrl: 'https://api.openai.com/v1/chat/completions', httpReferer: '', title: '' },
      model: 'gpt-4o-mini',
      apiKey: 'server-key',
      credentialSource: 'server',
    },
    {
      feature: 'search',
      providerId: 'openai',
      provider: { id: 'openai', label: 'OpenAI', endpointUrl: 'https://api.openai.com/v1/chat/completions', httpReferer: '', title: '' },
      model: 'gpt-4.1-mini',
      apiKey: 'server-key',
      credentialSource: 'server',
    },
  ];

  let resolveIndex = 0;
  const resolver = {
    resolveAiRequestForUser: async () => requests[resolveIndex++],
  };
  const client = {
    generateJson: async (args: { model: string }) => {
      if (args.model === 'gpt-4o-mini') {
        throw new HttpError(502, 'Rate limited', {
          provider: 'openai',
          providerStatus: 429,
          retryAfterSeconds: 120,
          failureKind: 'provider_response',
        });
      }
      return { ok: true, model: args.model };
    },
  };

  const executor = new AiRequestExecutor(resolver as never, client as never);
  const result = await executor.generateJsonForUser({
    userId: 'user-1',
    feature: 'search',
    userPrompt: 'hello',
  });

  assert.deepEqual(result.payload, { ok: true, model: 'gpt-4.1-mini' });
  assert.equal(result.request.model, 'gpt-4.1-mini');
});

test('request executor blocks server provider on auth-like failures', async () => {
  const { AiRequestExecutor } = await import('./ai-request-executor.js');
  const state = await import('./ai-server-fallback-state.js');

  state.resetServerFallbackState();

  const resolver = {
    resolveAiRequestForUser: async () => ({
      feature: 'search',
      providerId: 'openai',
      provider: { id: 'openai', label: 'OpenAI', endpointUrl: 'https://api.openai.com/v1/chat/completions', httpReferer: '', title: '' },
      model: 'gpt-4o-mini',
      apiKey: 'server-key',
      credentialSource: 'server',
    }),
  };
  const client = {
    generateJson: async () => {
      throw new HttpError(502, 'Insufficient quota', {
        provider: 'openai',
        providerStatus: 403,
        providerErrorCode: 'insufficient_quota',
        failureKind: 'provider_response',
      });
    },
  };

  const executor = new AiRequestExecutor(resolver as never, client as never);
  await assert.rejects(
    () => executor.generateJsonForUser({
      userId: 'user-1',
      feature: 'search',
      userPrompt: 'hello',
    }),
    /temporarily unavailable/,
  );

  assert.equal(state.isServerProviderBlocked('openai'), true);
});
