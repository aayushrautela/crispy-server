import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { setTestEnv } from '../../test-helpers.js';
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
import type { ProfileRecord } from '../../modules/profiles/profile.repo.js';
import type { AppGrant, AppGrantAction, AppGrantResourceType, AppPurpose, AppScope } from '../../modules/apps/app-principal.types.js';

setTestEnv({
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  JWT_SECRET: 'test-jwt-secret',
  CRISPY_RECOMMENDER_API_TOKEN_HASH: 'unused-token-hash',
});

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
  async authenticateRequest(): Promise<AppPrincipal> { return this.principal; }
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

async function buildServer(principal = buildPrincipal(), ownedProfiles: Array<{ accountId: string; profileId: string }> = []) {
  const app = Fastify();
  const authService = new FakeAuthService(principal);
  const rateLimitService = new FakeRateLimitService();
  const auditRepo = new FakeAuditRepo();
  const profileService = {
    async requireOwnedProfile(accountId: string, profileId: string): Promise<ProfileRecord> {
      const owned = ownedProfiles.some((profile) => profile.accountId === accountId && profile.profileId === profileId);
      if (!owned) {
        const { HttpError } = await import('../../lib/errors.js');
        throw new HttpError(404, 'Profile not found.');
      }
      return { id: profileId, profileGroupId: 'group-1', name: 'Test Profile', avatarKey: null, isKids: false, sortOrder: 0, createdByUserId: accountId, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    },
  };
  const { default: appAuthPlugin } = await import('../plugins/app-auth.plugin.js');
  const { registerInternalAppsRoutes } = await import('./internal-apps.routes.js');
  await app.register(appAuthPlugin, { appAuthService: authService, appRateLimitService: rateLimitService, appAuditRepo: auditRepo });
  app.addHook('onRequest', async (request) => {
    request.appPrincipal = principal;
  });
  await registerInternalAppsRoutes(app, {
    appAuthService: authService,
    appAuthorizationService: new FakeAuthorizationService(),
    appRateLimitService: rateLimitService,
    appSelfService: { async getAppSelf(p) { return { appId: p.appId, name: p.registryEntry.name, status: p.registryEntry.status, principalType: p.registryEntry.principalType, scopes: p.scopes, ownedSources: p.ownedSources, ownedListKeys: p.ownedListKeys, rateLimitPolicy: p.rateLimitPolicy }; } } satisfies AppSelfService,
    profileEligibilityService: { async check() { return { accountId: 'acc-999', profileId: 'prof-888', purpose: 'recommendation-generation', eligible: true, eligibilityVersion: 1, reasons: [], policy: { accountActive: true, profileActive: true, profileDeleted: false, profileLocked: false, recommendationsEnabled: true, aiPersonalizationEnabled: true, accountAllowsPersonalization: true, consentAllowsProcessing: true, maturityPolicyAllowsReco: true, appGrantAllowsProfile: true }, checkedAt: new Date('2024-01-01T00:00:00.000Z') }; }, async assertEligible() { throw new Error('not used'); }, async recomputeAndStore() { throw new Error('not used'); } } satisfies ProfileEligibilityService,
    eligibleProfileChangeFeedService: { async listChanges() { return { items: [], cursor: { hasMore: false, next: null } }; }, async recordProfileSignalChange() {}, async recordEligibilityChange() {} } satisfies EligibleProfileChangeFeedService,
    eligibleProfileSnapshotService: { async createSnapshot() { throw new Error('not used'); }, async listItems() { throw new Error('not used'); } } satisfies EligibleProfileSnapshotService,
    profileSignalBundleService: { async getBundle() { return { accountId: 'acc-999', profileId: 'prof-888', purpose: 'recommendation-generation', eligibility: { eligible: true, eligibilityVersion: 1 }, bundle: { signalsVersion: 1, generatedAt: new Date('2024-01-01T00:00:00.000Z'), profileContext: { profileName: 'Test Profile', isKids: false, watchDataOrigin: 'server_sync' }, history: [{ mediaKey: 'movie:tmdb:101', contentType: 'movie', watchedAt: new Date('2024-01-01T00:00:00.000Z'), progressPercent: 100, completionState: 'completed', durationSeconds: null }], ratings: [], watchlist: [], continueWatching: [] }, limits: {} }; } } satisfies ProfileSignalBundleService,
    serviceRecommendationListService: { async listWritableLists() { return { appId: 'test-app', source: 'reco', lists: [] }; }, async upsertList() { return { accountId: 'acc-999', profileId: 'prof-888', listKey: 'for-you', source: 'official-recommender', version: 1, status: 'written', itemCount: 0, idempotency: { replayed: false, key: 'test-key-123' }, createdAt: new Date('2024-01-01T00:00:00.000Z'), eligibility: { checkedAt: new Date('2024-01-01T00:00:00.000Z'), eligible: true, eligibilityVersion: 1 } }; }, async batchUpsert() { throw new Error('not used'); } } satisfies ServiceRecommendationListService,
    recommendationRunService: { async createRun() { throw new Error('not used'); }, async updateRun() { throw new Error('not used'); } } satisfies RecommendationRunService,
    recommendationBatchService: { async createBatch() { throw new Error('not used'); }, async updateBatch() { throw new Error('not used'); } } satisfies RecommendationBatchService,
    recommendationBackfillService: { async getAssignments() { return { assignments: [], cursor: { hasMore: false, next: null } }; } } satisfies RecommendationBackfillService,
    appAuditRepo: auditRepo,
    profileService,
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

test('GET /internal/apps/v1/accounts/:accountId/profiles/:profileId/eligibility validates ownership', async (t) => {
  const app = await buildServer(buildPrincipal(['apps:self:read', 'profiles:eligible:read']));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/apps/v1/accounts/acc-123/profiles/prof-456/eligibility',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'Profile not found.');
});

test('GET /internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/recommendation-bundle validates ownership', async (t) => {
  const app = await buildServer(buildPrincipal(['apps:self:read', 'profiles:eligible:read']));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/apps/v1/accounts/acc-123/profiles/prof-456/signals/recommendation-bundle',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'Profile not found.');
});

test('PUT /internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey validates ownership', async (t) => {
  const app = await buildServer(buildPrincipal(['apps:self:read', 'recommendations:service-lists:write']));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PUT',
    url: '/internal/apps/v1/accounts/acc-123/profiles/prof-456/recommendations/lists/for-you',
    headers: { 'idempotency-key': 'test-key-123' },
    payload: { purpose: 'recommendation-generation', writeMode: 'replace', items: [] },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'Profile not found.');
});

test('official recommender with accounts:all:read can access profile eligibility across accounts', async (t) => {
  const officialPrincipal = buildPrincipal(['apps:self:read', 'accounts:all:read', 'profiles:eligible:read']);
  officialPrincipal.appId = 'official-recommender';
  const app = await buildServer(officialPrincipal, []);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/apps/v1/accounts/acc-999/profiles/prof-888/eligibility',
  });

  assert.equal(response.statusCode, 200);
});

test('official recommender with accounts:all:read can access profile signals across accounts', async (t) => {
  const officialPrincipal = buildPrincipal(['apps:self:read', 'accounts:all:read', 'profiles:signals:read']);
  officialPrincipal.appId = 'official-recommender';
  const app = await buildServer(officialPrincipal, []);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/apps/v1/accounts/acc-999/profiles/prof-888/signals/recommendation-bundle',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().bundle.history[0].mediaKey, 'movie:tmdb:101');
  assert.equal('contentId' in response.json().bundle.history[0], false);
});

test('official recommender with accounts:all:write can write recommendations across accounts', async (t) => {
  const officialPrincipal = buildPrincipal(['apps:self:read', 'accounts:all:write', 'recommendations:service-lists:write']);
  officialPrincipal.appId = 'official-recommender';
  officialPrincipal.ownedSources = ['official-recommender'];
  const app = await buildServer(officialPrincipal, []);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PUT',
    url: '/internal/apps/v1/accounts/acc-999/profiles/prof-888/recommendations/lists/for-you',
    headers: { 'idempotency-key': 'test-key-123' },
    payload: { purpose: 'recommendation-generation', writeMode: 'replace', items: [] },
  });

  assert.equal(response.statusCode, 201);
});

test('normal app without accounts:all:read is denied cross-account profile eligibility', async (t) => {
  const normalPrincipal = buildPrincipal(['apps:self:read', 'profiles:eligible:read']);
  const app = await buildServer(normalPrincipal, []);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/apps/v1/accounts/acc-999/profiles/prof-888/eligibility',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'Profile not found.');
});

test('normal app without accounts:all:read is denied cross-account profile signals', async (t) => {
  const normalPrincipal = buildPrincipal(['apps:self:read', 'profiles:signals:read']);
  const app = await buildServer(normalPrincipal, []);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/apps/v1/accounts/acc-999/profiles/prof-888/signals/recommendation-bundle',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'Profile not found.');
});

test('normal app without accounts:all:write is denied cross-account recommendation writes', async (t) => {
  const normalPrincipal = buildPrincipal(['apps:self:read', 'recommendations:service-lists:write']);
  const app = await buildServer(normalPrincipal, []);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PUT',
    url: '/internal/apps/v1/accounts/acc-999/profiles/prof-888/recommendations/lists/for-you',
    headers: { 'idempotency-key': 'test-key-123' },
    payload: { purpose: 'recommendation-generation', writeMode: 'replace', items: [] },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'Profile not found.');
});

test('non-official-recommender app with accounts:all:read scope is still denied cross-account access', async (t) => {
  const nonOfficialPrincipal = buildPrincipal(['apps:self:read', 'accounts:all:read', 'profiles:eligible:read']);
  nonOfficialPrincipal.appId = 'some-other-app';
  const app = await buildServer(nonOfficialPrincipal, []);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/apps/v1/accounts/acc-999/profiles/prof-888/eligibility',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'Profile not found.');
});
