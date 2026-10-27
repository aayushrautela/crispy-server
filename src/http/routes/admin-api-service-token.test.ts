import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AppAuditRepo,
  CreateAppAuditEventInput,
  AppAuditEventRecord,
  PaginatedAppAuditEvents,
} from '../../modules/apps/app-audit.repo.js';
import type { AppGrantRepo } from '../../modules/apps/app-grant.repo.js';
import type { AppGrant, AppScope, AppRateLimitPolicy } from '../../modules/apps/app-principal.types.js';
import type { AppRegistryRepo } from '../../modules/apps/app-registry.repo.js';
import type { AppSourceOwnershipRepo, AppSourceOwnership } from '../../modules/apps/app-source-ownership.repo.js';
import type { AppRateLimitService, AppRateLimitDecision } from '../../modules/apps/app-rate-limit.service.js';
import { setTestEnv } from '../../test-helpers.js';

const RECOMMENDER_TOKEN = 'reco-service-token';

setTestEnv({
  ADMIN_UI_USER: 'admin-user',
  ADMIN_UI_PASSWORD: 'admin-pass',
  ADMIN_UI_SESSION_SECRET: 'admin-session-secret-for-tests',
  // sha256(RECOMMENDER_TOKEN): the token below is a genuinely valid recommender
  // service token, so a 401 can only come from the admin authentication path.
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
    return ['apps:self:read', 'accounts:all:read'];
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
  async insert(event: CreateAppAuditEventInput): Promise<AppAuditEventRecord> {
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

async function buildApp() {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { default: appAuthPlugin } = await import('../plugins/app-auth.plugin.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await app.register(appAuthPlugin, {
    appRateLimitService: new FakeRateLimitService(),
    appAuditRepo: new FakeAuditRepo(),
    appRegistryRepo: new FakeRegistryRepo(),
    appGrantRepo: new FakeGrantRepo(),
    sourceOwnershipRepo: new FakeSourceOwnershipRepo(),
    clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
  });
  await registerAdminUiRoutes(app);
  await registerAdminApiRoutes(app);

  return app;
}

test('the recommender service token cannot read another account\'s admin watch history', async (t) => {
  const app = await buildApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/admin/api/accounts/acc-1/profiles/prof-1/watch-history',
    headers: { authorization: `Bearer ${RECOMMENDER_TOKEN}` },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.message, 'Admin authentication required.');
});

test('the recommender service token cannot look up accounts by email through the admin api', async (t) => {
  const app = await buildApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/admin/api/accounts/lookup-by-email/user@example.com',
    headers: { authorization: `Bearer ${RECOMMENDER_TOKEN}` },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.message, 'Admin authentication required.');
});

test('the recommender service token cannot read another account\'s taste profile', async (t) => {
  const app = await buildApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/admin/api/accounts/acc-1/profiles/prof-1/taste-profile',
    headers: { authorization: `Bearer ${RECOMMENDER_TOKEN}` },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.message, 'Admin authentication required.');
});
