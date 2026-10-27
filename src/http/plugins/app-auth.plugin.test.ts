import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppAuditRepo, CreateAppAuditEventInput, AppAuditEventRecord, PaginatedAppAuditEvents } from '../../modules/apps/app-audit.repo.js';
import type { AppGrantRepo } from '../../modules/apps/app-grant.repo.js';
import type { AppGrant } from '../../modules/apps/app-principal.types.js';
import type { AppRegistryRepo } from '../../modules/apps/app-registry.repo.js';
import type { AppScope, AppRateLimitPolicy } from '../../modules/apps/app-principal.types.js';
import type { AppSourceOwnershipRepo, AppSourceOwnership } from '../../modules/apps/app-source-ownership.repo.js';
import type { AppRateLimitService, AppRateLimitDecision } from '../../modules/apps/app-rate-limit.service.js';
import { setTestEnv } from '../../test-helpers.js';

const RECOMMENDER_TOKEN = 'reco-service-token';

setTestEnv({
  AUTH_BASE_URL: 'http://localhost:54321',
  AUTH_ADMIN_API_KEY: 'service-role-key',
  JWT_SECRET: 'test-jwt-secret',
  // sha256(RECOMMENDER_TOKEN)
  RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH: '42e3a67fc454b0c9b2974cb3a9ef0ce86ef1457494dd4f4aadee148f98a8a3b2',
});

class FakeRateLimitService implements AppRateLimitService {
  async checkAndConsume(): Promise<AppRateLimitDecision> {
    return { allowed: true };
  }
}

class FakeRegistryRepo implements Pick<AppRegistryRepo, 'findAppById' | 'listScopesForApp' | 'getRateLimitPolicy'> {
  async findAppById(appId: string) {
    if (appId === 'reco') {
      return {
        appId: 'reco',
        name: 'Recommender',
        description: 'Recommender service app',
        status: 'active' as const,
        ownerTeam: 'reco',
        allowedEnvironments: ['production'],
        principalType: 'service_app' as const,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        disabledAt: undefined,
      };
    }
    return null;
  }
  async listScopesForApp(_appId: string): Promise<AppScope[]> {
    return ['apps:self:read', 'accounts:all:read', 'profiles:signals:read', 'recommendations:service-lists:write'];
  }
  async getRateLimitPolicy(_appId: string): Promise<AppRateLimitPolicy> {
    return {
      profileChangesReadsPerMinute: 60,
      profileSignalReadsPerMinute: 60,
      recommendationWritesPerMinute: 60,
      batchWritesPerMinute: 10,
      configBundleReadsPerMinute: 60,
      runsPerHour: 10,
      snapshotsPerDay: 5,
      maxProfilesPerBatch: 100,
      maxItemsPerList: 50,
    };
  }
}

class FakeGrantRepo implements Pick<AppGrantRepo, 'listActiveGrantsForApp'> {
  async listActiveGrantsForApp(_appId: string, _now: Date): Promise<AppGrant[]> {
    return [];
  }
}

class FakeSourceOwnershipRepo implements Pick<AppSourceOwnershipRepo, 'findByAppId'> {
  async findByAppId(_appId: string): Promise<AppSourceOwnership[]> {
    return [];
  }
}

class FakeAuditRepo implements AppAuditRepo {
  readonly inserted: CreateAppAuditEventInput[] = [];

  async insert(event: CreateAppAuditEventInput): Promise<AppAuditEventRecord> {
    this.inserted.push(event);
    return {
      eventId: 'event-id',
      appId: event.appId,
      keyId: event.keyId,
      action: event.action,
      accountId: event.accountId,
      profileId: event.profileId,
      runId: event.runId,
      batchId: event.batchId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      requestId: event.requestId,
      metadata: event.metadata,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };
  }

  async listForApp(): Promise<PaginatedAppAuditEvents> {
    return { events: [], cursor: { hasMore: false, nextCursor: null } };
  }
}

async function buildApp(auditRepo = new FakeAuditRepo()) {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('./error-handler.js');
  const { default: appAuthPlugin } = await import('./app-auth.plugin.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(appAuthPlugin, {
    appRateLimitService: new FakeRateLimitService(),
    appAuditRepo: auditRepo,
    appRegistryRepo: new FakeRegistryRepo(),
    appGrantRepo: new FakeGrantRepo(),
    sourceOwnershipRepo: new FakeSourceOwnershipRepo(),
    clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
  });

  app.get('/internal/apps/v1/test', async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    return { appId: principal.appId, keyId: principal.keyId, requestPrincipalAppId: request.appPrincipal?.appId };
  });

  return { app, auditRepo };
}

test('recommender auth accepts the env-var service token and builds the reco principal', async (t) => {
  const { app, auditRepo } = await buildApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/apps/v1/test',
    headers: { authorization: `Bearer ${RECOMMENDER_TOKEN}` },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    appId: 'reco',
    keyId: '00000000-0000-0000-0000-000000000001',
    requestPrincipalAppId: 'reco',
  });
  assert.equal(auditRepo.inserted[0]?.action, 'app_authenticated');
});

test('recommender auth rejects a missing bearer token', async (t) => {
  const { app } = await buildApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/internal/apps/v1/test' });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.message, 'Missing recommender bearer token.');
});

test('recommender auth rejects an invalid bearer token', async (t) => {
  const { app } = await buildApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/apps/v1/test',
    headers: { authorization: 'Bearer not-the-service-token' },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.message, 'Invalid recommender bearer token.');
});
