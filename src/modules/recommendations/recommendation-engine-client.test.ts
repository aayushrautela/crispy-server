import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { RecommendationWorkerGenerateRequest } from './recommendation-worker.types.js';

seedTestEnv();

const { RecommendationEngineClient } = await import('./recommendation-engine-client.js');

const sampleRequest: RecommendationWorkerGenerateRequest = {
  identity: {
    accountId: 'account-1',
    profileId: 'profile-1',
  },
  generationMeta: {
    sourceKey: 'default',
    algorithmVersion: 'v3.2.1',
    historyGeneration: 12,
    sourceCursor: 'cursor-1',
  },
  watchHistory: [],
  ratings: [],
  watchlist: [],
  profileContext: {
    profileName: 'Main',
    isKids: false,
    watchDataOrigin: 'provider_sync',
  },
  aiConfig: {
    providerId: 'openai',
    endpointUrl: 'https://example.com/v1/chat/completions',
    httpReferer: 'https://crispy.example',
    title: 'Crispy',
    model: 'gpt-4o-mini',
    apiKey: 'secret',
    credentialSource: 'server' as const,
  },
};

test('submitGeneration sends async submission headers and parses response', async (t) => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedMethod = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (async (input, init) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    capturedMethod = init?.method ?? '';
    capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
    capturedBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({
      jobId: 'worker-job-1',
      status: 'queued',
      idempotencyKey: 'idem-1',
      acceptedAt: '2026-04-04T00:00:00.000Z',
      pollAfterSeconds: 7,
    }), { status: 202, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new RecommendationEngineClient({
    baseUrl: 'https://worker.example',
    apiKey: 'worker-key',
    serviceId: 'crispy-server',
    submitTimeoutMs: 5000,
  });

  const result = await client.submitGeneration(sampleRequest, {
    idempotencyKey: 'idem-1',
    requestId: 'req-1',
  });

  assert.equal(capturedUrl, 'https://worker.example/v1/generations');
  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedHeaders['x-service-id'], 'crispy-server');
  assert.equal(capturedHeaders['x-api-key'], 'worker-key');
  assert.equal(capturedHeaders['idempotency-key'], 'idem-1');
  assert.equal(capturedHeaders['x-request-id'], 'req-1');
  assert.equal(capturedHeaders['content-type'], 'application/json');
  assert.deepEqual(capturedBody, sampleRequest);
  assert.equal(result.jobId, 'worker-job-1');
  assert.equal(result.status, 'queued');
  assert.equal(result.pollAfterSeconds, 7);
});

test('getGenerationStatus sends request id and parses response', async (t) => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};

  globalThis.fetch = (async (input, init) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({
      jobId: 'worker-job-1',
      status: 'running',
      idempotencyKey: 'idem-1',
      startedAt: '2026-04-04T00:00:10.000Z',
      pollAfterSeconds: 5,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new RecommendationEngineClient({
    baseUrl: 'https://worker.example',
    apiKey: 'worker-key',
    serviceId: 'crispy-server',
    statusTimeoutMs: 5000,
  });

  const result = await client.getGenerationStatus('worker/job 1', 'req-2');

  assert.equal(capturedUrl, 'https://worker.example/v1/generations/worker%2Fjob%201');
  assert.equal(capturedHeaders['x-request-id'], 'req-2');
  assert.equal(capturedHeaders['x-service-id'], 'crispy-server');
  assert.equal(capturedHeaders['x-api-key'], 'worker-key');
  assert.equal(result.status, 'running');
  assert.equal(result.pollAfterSeconds, 5);
});

test('submitGeneration preserves nested worker error messages', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({
      error: {
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'same idempotency key with different body',
      },
    }), { status: 409, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new RecommendationEngineClient({
    baseUrl: 'https://worker.example',
    apiKey: 'worker-key',
    serviceId: 'crispy-server',
  });

  await assert.rejects(
    () => client.submitGeneration(sampleRequest, { idempotencyKey: 'idem-1', requestId: 'req-3' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /same idempotency key with different body/);
      return true;
    },
  );
});
