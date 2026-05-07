import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { setTestEnv } from '../../test-helpers.js';
import type { AppPrincipal } from '../../modules/apps/app-principal.types.js';
import type { AppAuthService, AppCredential } from '../../modules/apps/app-auth.service.js';
import type { AppRateLimitDecision, AppRateLimitService } from '../../modules/apps/app-rate-limit.service.js';
import type { AppAuthorizationService } from '../../modules/apps/app-authorization.service.js';
import type { RecommendationAiPlanRequest, RecommendationAiPlanResponse } from '../../modules/recommendations/recommendation-ai-plan.types.js';
import { RecommendationAiPlanService } from '../../modules/recommendations/recommendation-ai-plan.service.js';

setTestEnv({
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  JWT_SECRET: 'test-jwt-secret',
  CRISPY_RECOMMENDER_API_TOKEN_HASH: 'unused-token-hash',
});

function buildPrincipal(scopes: string[] = ['recommendations:ai-plan:generate']): AppPrincipal {
  return {
    principalType: 'app',
    appId: 'official-recommender',
    keyId: 'test-key',
    scopes: scopes as never[],
    grants: [],
    ownedSources: ['reco'],
    ownedListKeys: ['for-you'],
    rateLimitPolicy: {
      profileChangesReadsPerMinute: 60,
      profileSignalReadsPerMinute: 60,
      recommendationWritesPerMinute: 60,
      batchWritesPerMinute: 10,
      configBundleReadsPerMinute: 60,
      runsPerHour: 10,
      snapshotsPerDay: 5,
      maxProfilesPerBatch: 100,
      maxItemsPerList: 50,
    },
    registryEntry: {
      appId: 'official-recommender',
      name: 'Official Recommender',
      status: 'active',
      ownerTeam: 'platform',
      allowedEnvironments: ['test'],
      principalType: 'service_app',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    },
  };
}

class FakeAuthService implements AppAuthService {
  constructor(private readonly principal: AppPrincipal) {}
  async authenticateRequest(): Promise<AppPrincipal> { return this.principal; }
  parseAuthorizationHeader(_value?: string): AppCredential { return { scheme: 'AppKey', keyId: 'test-key', secretOrSignature: 'secret' }; }
  assertScope(): void {}
}

class FakeRateLimitService implements AppRateLimitService {
  async checkAndConsume(): Promise<AppRateLimitDecision> { return { allowed: true }; }
}

class FakeAuthorizationService implements AppAuthorizationService {
  requireScope(): void {}
  requireGrant(): never { throw new Error('not used'); }
  requireOwnedSource(): void {}
  requireOwnedListKey(): void {}
}

class FakeRecommendationAiPlanService extends RecommendationAiPlanService {
  constructor(private readonly mockResponse?: RecommendationAiPlanResponse | Error) {
    super();
  }

  async generatePlan(request: RecommendationAiPlanRequest): Promise<RecommendationAiPlanResponse> {
    if (this.mockResponse instanceof Error) {
      throw this.mockResponse;
    }
    if (this.mockResponse) {
      return this.mockResponse;
    }
    return {
      schemaVersion: 1,
      requestId: request.requestId,
      runId: request.runId,
      listKey: request.listKey,
      generatedAt: new Date().toISOString(),
      plan: {
        summary: 'Test summary',
        items: [],
      },
      diagnostics: {
        aiPlanVersion: 'test-provider:test-model',
        latencyMs: 100,
      },
    };
  }
}

async function buildServer(principal = buildPrincipal(), service: RecommendationAiPlanService = new FakeRecommendationAiPlanService()) {
  const app = Fastify();
  const authService = new FakeAuthService(principal);
  const rateLimitService = new FakeRateLimitService();
  const { default: appAuthPlugin } = await import('../plugins/app-auth.plugin.js');
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { registerInternalRecommendationsRoutes } = await import('./internal-recommendations.routes.js');
  await app.register(errorHandlerPlugin);
  await app.register(appAuthPlugin, { appAuthService: authService, appRateLimitService: rateLimitService, appAuditRepo: null as never });
  app.addHook('onRequest', async (request) => {
    request.appPrincipal = principal;
  });
  await registerInternalRecommendationsRoutes(app, {
    appAuthorizationService: new FakeAuthorizationService(),
    appRateLimitService: rateLimitService,
    recommendationAiPlanService: service,
  });
  return app;
}

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

test('POST /internal/recommendations/v1/accounts/:accountId/profiles/:profileId/ai-plan returns 200 for valid request', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: validRequest,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.requestId, 'req-123');
  assert.equal(body.runId, 'run-123');
  assert.equal(body.listKey, 'for-you');
  assert.ok(body.plan);
  assert.ok(body.diagnostics);
});

test('POST ai-plan rejects request with provider field', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const invalid = { ...validRequest, provider: 'openai' };
  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: invalid,
  });

  assert.equal(response.statusCode, 400);
  assert.ok(response.json().error.message.includes('provider'));
});

test('POST ai-plan rejects request with model field', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const invalid = { ...validRequest, model: 'gpt-4' };
  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: invalid,
  });

  assert.equal(response.statusCode, 400);
  assert.ok(response.json().error.message.includes('model'));
});

test('POST ai-plan rejects request with proxyEndpoint field', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const invalid = { ...validRequest, proxyEndpoint: 'https://proxy.example.com' };
  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: invalid,
  });

  assert.equal(response.statusCode, 400);
  assert.ok(response.json().error.message.includes('proxyEndpoint'));
});

test('POST ai-plan rejects request with messages field', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const invalid = { ...validRequest, messages: [] };
  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: invalid,
  });

  assert.equal(response.statusCode, 400);
  assert.ok(response.json().error.message.includes('messages'));
});

test('POST ai-plan rejects request with prompt field', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const invalid = { ...validRequest, prompt: 'some prompt' };
  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: invalid,
  });

  assert.equal(response.statusCode, 400);
  assert.ok(response.json().error.message.includes('prompt'));
});

test('POST ai-plan rejects request with aiConfig field', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const invalid = { ...validRequest, aiConfig: {} };
  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: invalid,
  });

  assert.equal(response.statusCode, 400);
  assert.ok(response.json().error.message.includes('aiConfig'));
});

test('POST ai-plan rejects unsupported schema version', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const invalid = { ...validRequest, schemaVersion: 2 };
  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: invalid,
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'UNSUPPORTED_AI_PLAN_SCHEMA_VERSION');
});

test('POST ai-plan rejects empty candidate pool', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const invalid = { ...validRequest, candidatePool: [] };
  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: invalid,
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, 'EMPTY_CANDIDATE_POOL');
});

for (const errorCase of [
  { name: 'provider unavailable', statusCode: 503, code: 'AI_PLAN_PROVIDER_UNAVAILABLE' },
  { name: 'timeout', statusCode: 504, code: 'AI_PLAN_TIMEOUT' },
  { name: 'rate limited', statusCode: 429, code: 'AI_PLAN_RATE_LIMITED' },
] as const) {
  test(`POST ai-plan maps ${errorCase.name} to canonical AI-plan error envelope`, async (t) => {
    const { HttpError } = await import('../../lib/errors.js');
    const app = await buildServer(
      buildPrincipal(),
      new FakeRecommendationAiPlanService(new HttpError(errorCase.statusCode, errorCase.name, { code: errorCase.code, retryable: true }, errorCase.code)),
    );
    t.after(async () => { await app.close(); });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
      headers: { 'x-request-id': 'req-route-error-test' },
      payload: validRequest,
    });

    assert.equal(response.statusCode, errorCase.statusCode);
    const body = response.json();
    assert.equal(body.error.code, errorCase.code);
    assert.equal(body.error.retryable, true);
    assert.equal(body.error.requestId, 'req-route-error-test');
    assert.equal(body.error.details?.code, undefined);
  });
}

test('POST ai-plan rejects path/body accountId mismatch', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_999/profiles/prof_456/ai-plan',
    payload: validRequest,
  });

  assert.equal(response.statusCode, 400);
  assert.ok(response.json().error.message.includes('accountId'));
});

test('POST ai-plan rejects path/body profileId mismatch', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_999/ai-plan',
    payload: validRequest,
  });

  assert.equal(response.statusCode, 400);
  assert.ok(response.json().error.message.includes('profileId'));
});

test('POST ai-plan response does not expose AI provider/model/proxy', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/recommendations/v1/accounts/acc_123/profiles/prof_456/ai-plan',
    payload: validRequest,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  const bodyStr = JSON.stringify(body);
  
  // Response should not contain these fields
  assert.ok(!bodyStr.includes('apiKey'));
  assert.ok(!bodyStr.includes('endpointUrl'));
  assert.ok(!bodyStr.includes('proxyEndpoint'));
  assert.ok(!bodyStr.includes('credentialSource'));
  assert.ok(!bodyStr.includes('secretDelivery'));
  
  // Should contain only allowed fields
  assert.ok(body.plan);
  assert.ok(body.diagnostics);
  assert.ok(body.diagnostics.aiPlanVersion);
  assert.ok(typeof body.diagnostics.latencyMs === 'number');
});
