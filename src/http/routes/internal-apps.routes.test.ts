import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import appAuthPlugin from '../plugins/app-auth.plugin.js';
import { registerInternalAppsRoutes } from './internal-apps.routes.js';
import type { AppPrincipal } from '../../modules/apps/app-principal.types.js';
import type { AppAuthService, AppCredential } from '../../modules/apps/app-auth.service.js';
import type { AppRateLimitDecision, AppRateLimitService } from '../../modules/apps/app-rate-limit.service.js';
import type { AppAuditEventRecord, AppAuditRepo, CreateAppAuditEventInput, PaginatedAppAuditEvents } from '../../modules/apps/app-audit.repo.js';
import type { AppAuthorizationService } from '../../modules/apps/app-authorization.service.js';
import type { AppSelfService } from '../../modules/apps/app-self.service.js';
import type { ProfileEligibilityService } from '../../modules/apps/profile-eligibility.service.js';
import type { EligibleProfileChangeFeedService } from '../../modules/apps/eligible-profile-change-feed.service.js';
import type { EligibleProfileSnapshotService } from '../../modules/apps/eligible-profile-snapshot.types.js';
import type { ProfileSignalBundleService } from '../../modules/apps/profile-signal-bundle.types.js';
import type { ServiceRecommendationListService } from '../../modules/apps/service-recommendation-list.service.js';
import type { RecommendationRunService } from '../../modules/apps/recommendation-run.service.js';
import type { RecommendationBatchService } from '../../modules/apps/recommendation-batch.service.js';
import type { RecommendationBackfillService } from '../../modules/apps/recommendation-backfill.service.js';
import type { AppGrant, AppGrantAction, AppGrantResourceType, AppPurpose, AppScope } from '../../modules/apps/app-principal.types.js';

function buildPrincipal(scopes: AppScope[] = ['apps:self:read']): AppPrincipal {
  return {
    principalType: 'app',
    appId: 'test-app',
    keyId: 'test-key',
    scopes,
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
      appId: 'test-app',
      name: 'Test App',
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
  async authenticateRequest(_request: FastifyRequest): Promise<AppPrincipal> { return this.principal; }
  parseAuthorizationHeader(_value?: string): AppCredential { return { scheme: 'AppKey', keyId: 'test-key', secretOrSignature: 'secret' }; }
  assertScope(principal: AppPrincipal, requiredScope: AppScope): void {
    if (!principal.scopes.includes(requiredScope)) throw new Error('scope missing');
  }
}

class FakeRateLimitService implements AppRateLimitService {
  async checkAndConsume(): Promise<AppRateLimitDecision> { return { allowed: true }; }
}

class FakeAuditRepo implements AppAuditRepo {
  async insert(event: CreateAppAuditEventInput): Promise<AppAuditEventRecord> {
    return { eventId: 'event', appId: event.appId, keyId: event.keyId, action: event.action, createdAt: new Date('2024-01-01T00:00:00.000Z') };
  }
  async listForApp(): Promise<PaginatedAppAuditEvents> { return { events: [], cursor: { hasMore: false, next: null } }; }
}

class FakeAuthorizationService implements AppAuthorizationService {
  requireScope(input: { principal: AppPrincipal; scope: AppScope }): void {
    if (!input.principal.scopes.includes(input.scope)) throw new Error('scope missing');
  }
  requireGrant(): AppGrant { return { grantId: 'grant', appId: 'test-app', resourceType: 'profileEligibility' as AppGrantResourceType, resourceId: '*', purpose: 'recommendation-generation' as AppPurpose, actions: ['read'] as AppGrantAction[], constraints: {}, status: 'active', createdAt: new Date('2024-01-01T00:00:00.000Z') }; }
  requireOwnedSource(): void {}
  requireOwnedListKey(): void {}
}

async function buildServer(principal = buildPrincipal()) {
  const app = Fastify();
  const authService = new FakeAuthService(principal);
  const rateLimitService = new FakeRateLimitService();
  const auditRepo = new FakeAuditRepo();
  await app.register(appAuthPlugin, { appAuthService: authService, appRateLimitService: rateLimitService, appAuditRepo: auditRepo });
  await registerInternalAppsRoutes(app, {
    appAuthService: authService,
    appAuthorizationService: new FakeAuthorizationService(),
    appRateLimitService: rateLimitService,
    appSelfService: { async getAppSelf(p) { return { appId: p.appId, name: p.registryEntry.name, status: p.registryEntry.status, principalType: p.registryEntry.principalType, scopes: p.scopes, ownedSources: p.ownedSources, ownedListKeys: p.ownedListKeys, rateLimitPolicy: p.rateLimitPolicy }; } } satisfies AppSelfService,
    profileEligibilityService: { async check() { throw new Error('not used'); }, async assertEligible() { throw new Error('not used'); }, async recomputeAndStore() { throw new Error('not used'); } } satisfies ProfileEligibilityService,
    eligibleProfileChangeFeedService: { async listChanges() { return { items: [], cursor: { hasMore: false, next: null } }; }, async recordProfileSignalChange() {}, async recordEligibilityChange() {} } satisfies EligibleProfileChangeFeedService,
    eligibleProfileSnapshotService: { async createSnapshot() { throw new Error('not used'); }, async listItems() { throw new Error('not used'); } } satisfies EligibleProfileSnapshotService,
    profileSignalBundleService: { async getBundle() { throw new Error('not used'); } } satisfies ProfileSignalBundleService,
    serviceRecommendationListService: { async listWritableLists() { return { appId: 'test-app', source: 'reco', lists: [] }; }, async upsertList() { throw new Error('not used'); }, async batchUpsert() { throw new Error('not used'); } } satisfies ServiceRecommendationListService,
    recommendationRunService: { async createRun() { throw new Error('not used'); }, async updateRun() { throw new Error('not used'); } } satisfies RecommendationRunService,
    recommendationBatchService: { async createBatch() { throw new Error('not used'); }, async updateBatch() { throw new Error('not used'); } } satisfies RecommendationBatchService,
    recommendationBackfillService: { async getAssignments() { return { assignments: [], cursor: { hasMore: false, next: null } }; } } satisfies RecommendationBackfillService,
    appAuditRepo: auditRepo,
  });
  return app;
}

test('GET /internal/apps/v1/me returns authenticated app self', async (t) => {
  const app = await buildServer();
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/internal/apps/v1/me' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().appId, 'test-app');
  assert.deepEqual(response.json().scopes, ['apps:self:read']);
});

test('GET /internal/apps/v1/profiles/eligible/changes is registered', async (t) => {
  const app = await buildServer(buildPrincipal(['apps:self:read', 'profiles:eligible:read']));
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/internal/apps/v1/profiles/eligible/changes?limit=1' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { items: [], cursor: { hasMore: false, next: null } });
});

test('legacy integrations v1 RECO endpoints are absent', async (t) => {
  const app = await buildServer(buildPrincipal(['apps:self:read', 'profiles:eligible:read']));
  t.after(async () => { await app.close(); });

  const retiredBase = '/api/' + 'integrations/v1';
  const retiredPaths = [
    `${retiredBase}/recommendations/batch-upsert`,
    `${retiredBase}/profiles/eligible/changes`,
    `${retiredBase}/accounts/acc/profiles/prof/signals/recommendation-bundle`,
    `${retiredBase}/accounts/acc/profiles/prof/config-bundle`,
    `${retiredBase}/profiles/prof/recommendation-lists/for-you`,
  ];

  for (const url of retiredPaths) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 404, `${url} should be unregistered`);
  }

  const routes = app.printRoutes();
  assert.equal(routes.includes('/api/integrations/v1'), false);
});
