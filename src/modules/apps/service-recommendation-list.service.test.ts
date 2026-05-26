import test from 'node:test';
import assert from 'node:assert/strict';
import { DefaultServiceRecommendationListService } from './service-recommendation-list.service.js';
import { OFFICIAL_RECOMMENDER_APP_ID, OFFICIAL_RECOMMENDER_SOURCE } from './official-recommender-lists.js';
import type { AppAuditEventRecord, AppAuditRepo, CreateAppAuditEventInput, PaginatedAppAuditEvents } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import { DefaultAppAuthorizationService } from './app-authorization.service.js';
import type { AppGrant, AppGrantAction, AppGrantResourceType, AppPrincipal, AppPurpose, AppScope } from './app-principal.types.js';
import { SqlAppSourceOwnershipRepo } from './app-source-ownership.repo.js';
import type { ProfileEligibilityService } from './profile-eligibility.service.js';
import type { ServiceRecommendationListRepo } from './service-recommendation-list.repo.js';
import type { RecommendationListWriteService } from '../recommendations/recommendation-list-write.service.js';
import type { RecommendationListWriteInput, RecommendationListWriteResult } from '../recommendations/recommendation-list.types.js';
import { HttpError } from '../../lib/errors.js';

function buildPrincipal(scopes: AppScope[] = ['recommendations:service-lists:write', 'recommendations:service-lists:batch-write']): AppPrincipal {
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

class FakeAuthorizationService implements AppAuthorizationService {
  requireScope(input: { principal: AppPrincipal; scope: AppScope }): void {
    if (!input.principal.scopes.includes(input.scope)) throw new HttpError(403, 'scope missing', undefined, 'SCOPE_MISSING');
  }
  requireGrant(): AppGrant {
    return { grantId: 'grant', appId: 'test-app', resourceType: 'recommendationList' as AppGrantResourceType, resourceId: '*', purpose: 'recommendation-generation' as AppPurpose, actions: ['write'] as AppGrantAction[], constraints: {}, status: 'active', createdAt: new Date('2024-01-01T00:00:00.000Z') };
  }
  requireOwnedSource(): void {}
  requireOwnedListKey(): void {}
}

class FakeAuditRepo implements AppAuditRepo {
  events: CreateAppAuditEventInput[] = [];
  async insert(event: CreateAppAuditEventInput): Promise<AppAuditEventRecord> {
    this.events.push(event);
    return { eventId: 'event', appId: event.appId, keyId: event.keyId, action: event.action, createdAt: new Date('2024-01-01T00:00:00.000Z') };
  }
  async listForApp(): Promise<PaginatedAppAuditEvents> { return { events: [], cursor: { hasMore: false, nextCursor: null } }; }
}

class FakeServiceListRepo implements ServiceRecommendationListRepo {
  savedBatchRequestHash: string | null = null;
  savedBatchResultStatus: string | null = null;
  async findBatchIdempotency() { return null; }
  async saveBatchIdempotency(input: Parameters<ServiceRecommendationListRepo['saveBatchIdempotency']>[0]): Promise<void> {
    this.savedBatchRequestHash = input.requestHash;
    this.savedBatchResultStatus = input.result.status;
  }
}

class FakeRecommendationListWriteService implements RecommendationListWriteService {
  writes: RecommendationListWriteInput[] = [];
  async writeList(input: RecommendationListWriteInput): Promise<RecommendationListWriteResult> {
    this.writes.push(input);
    return { accountId: input.accountId, profileId: input.profileId, listKey: input.listKey, source: input.source, version: this.writes.length, status: 'written', itemCount: input.items.length, idempotency: { key: input.idempotencyKey, replayed: false }, createdAt: new Date('2024-01-01T00:00:00.000Z') };
  }
  async clearList(): Promise<RecommendationListWriteResult> { throw new Error('not used'); }
}

const eligibilityService: ProfileEligibilityService = {
  async check() { throw new Error('not used'); },
    async assertEligible() { return { accountId: 'acc-1', profileId: 'prof-1', purpose: 'recommendation-generation', eligible: true, eligibilityVersion: 42, reasons: [], policy: { accountActive: true, profileActive: true, profileDeleted: false, profileLocked: false, useOfficialRecommendationEngine: true, recommendationsEnabled: true, aiPersonalizationEnabled: true, accountAllowsPersonalization: true, consentAllowsProcessing: true, maturityPolicyAllowsReco: true, appGrantAllowsProfile: true }, checkedAt: new Date('2024-01-01T00:00:00.000Z') }; },
  async recomputeAndStore() { throw new Error('not used'); },
};

const PROVIDER_TO_CONTENT_ID: Record<string, string> = {
  '101': '00000000-0000-4000-8000-000000000101',
  '102': '00000000-0000-4000-8000-000000000102',
  '103': '00000000-0000-4000-8000-000000000103',
};

function buildWriteRequest(providerIds: string[] = ['101']) {
  return {
    title: 'For You',
    subtitle: null,
    sectionType: 'contentRail' as const,
    items: providerIds.map((providerId) => ({ type: 'movie' as const, providerRefs: [{ provider: 'tmdb' as const, providerId }], score: null, reason: null, reasonCodes: [], metadata: {} })),
    model: null,
    context: {},
  };
}

function buildService() {
  const serviceListRepo = new FakeServiceListRepo();
  const recommendationListWriteService = new FakeRecommendationListWriteService();
  const appAuditRepo = new FakeAuditRepo();
  const service = new DefaultServiceRecommendationListService({
    serviceListRepo,
    recommendationListWriteService,
    profileEligibilityService: eligibilityService,
    appAuthorizationService: new FakeAuthorizationService(),
    appAuditRepo,
    clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
    maxProfilesPerBatch: 10,
    maxListsPerProfile: 5,
    contentIdentityService: { async ensureTitleContentId(input) { return PROVIDER_TO_CONTENT_ID[input.providerId] ?? '00000000-0000-4000-8000-000000000999'; } },
  });
  return { service, serviceListRepo, recommendationListWriteService, appAuditRepo };
}

test('upsertList normalizes item refs and derives internal write fields', async () => {
  const { service, recommendationListWriteService } = buildService();

  const result = await service.upsertList({
    principal: buildPrincipal(),
    accountId: 'acc-1',
    profileId: 'prof-1',
    listKey: 'for-you',
    idempotencyKey: 'idem-1',
    request: buildWriteRequest(['101', '102']),
  });

  assert.equal(result.itemCount, 2);
  assert.equal(result.eligibility.eligibilityVersion, 42);
  assert.equal(recommendationListWriteService.writes.length, 1);
  const write = recommendationListWriteService.writes[0];
  assert.ok(write);
  assert.equal(write.purpose, 'recommendation-generation');
  assert.equal(write.writeMode, 'replace');
  assert.equal(write.title, 'For You');
  assert.equal(write.subtitle, null);
  assert.equal(write.sectionType, 'contentRail');
  assert.deepEqual(write.inputVersions, { eligibilityVersion: 42, modelVersion: null, algorithm: null });
  assert.deepEqual(write.items, [
    { itemId: '00000000000040008000000000000101', sourceRef: { provider: 'tmdb', providerId: '101' }, rank: 1, score: null, reason: null, reasonCodes: [], metadata: {} },
    { itemId: '00000000000040008000000000000102', sourceRef: { provider: 'tmdb', providerId: '102' }, rank: 2, score: null, reason: null, reasonCodes: [], metadata: {} },
  ]);
});

test('upsertList rejects legacy writer-supplied fields', async () => {
  const { service } = buildService();

  await assert.rejects(
    service.upsertList({
      principal: buildPrincipal(),
      accountId: 'acc-1',
      profileId: 'prof-1',
      listKey: 'for-you',
      idempotencyKey: 'idem-1',
      request: { ...buildWriteRequest(), items: [{ type: 'movie', providerRefs: [{ provider: 'tmdb', providerId: '101' }], rank: 1 }] } as never,
    }),
    (error: unknown) => error instanceof HttpError && error.code === 'UNSUPPORTED_RECOMMENDATION_WRITE_FIELD',
  );
});

test('official recommender rejects section type mismatches', async () => {
  const { service } = buildService();
  const principal = buildPrincipal();
  principal.appId = OFFICIAL_RECOMMENDER_APP_ID;
  principal.ownedSources = [OFFICIAL_RECOMMENDER_SOURCE];
  principal.ownedListKeys = ['hero-carousel'];

  await assert.rejects(
    service.upsertList({
      principal,
      accountId: 'acc-1',
      profileId: 'prof-1',
      listKey: 'hero-carousel',
      idempotencyKey: 'idem-1',
      request: buildWriteRequest(['101']),
    }),
    (error: unknown) => error instanceof HttpError && error.code === 'RECOMMENDATION_SECTION_TYPE_MISMATCH',
  );
});

test('batchUpsert normalizes list refs, derives per-list idempotency, and returns processed status', async () => {
  const { service, serviceListRepo, recommendationListWriteService } = buildService();

  const result = await service.batchUpsert({
    principal: buildPrincipal(),
    idempotencyKey: 'batch-1',
    request: {
      profiles: [{ accountId: 'acc-1', profileId: 'prof-1', lists: [{ listKey: 'for-you', ...buildWriteRequest(['103']) }] }],
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.summary.listsWritten, 1);
  assert.equal(result.summary.itemsWritten, 1);
  assert.equal(serviceListRepo.savedBatchResultStatus, 'completed');
  assert.ok(serviceListRepo.savedBatchRequestHash);
  const batchWrite = recommendationListWriteService.writes[0];
  assert.ok(batchWrite);
  assert.equal(batchWrite.idempotencyKey, 'batch-1:acc-1:prof-1:for-you');
  assert.deepEqual(batchWrite.items, [{ itemId: '00000000000040008000000000000103', sourceRef: { provider: 'tmdb', providerId: '103' }, rank: 1, score: null, reason: null, reasonCodes: [], metadata: {} }]);
});

test('authorization allows wildcard owned list keys', () => {
  const authorization = new DefaultAppAuthorizationService();
  const principal = buildPrincipal();
  principal.ownedListKeys = ['*'];

  assert.doesNotThrow(() => authorization.requireOwnedListKey({ principal, source: 'reco', listKey: 'hero-carousel' }));
});

test('source ownership allows wildcard owned list keys', async () => {
  const repo = new SqlAppSourceOwnershipRepo({
    db: {
      async query() {
        return {
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
          rows: [{ source: 'reco', app_id: 'test-app', allowed_list_keys: ['*'], status: 'active' }],
        };
      },
    },
  });

  await assert.doesNotReject(repo.assertAppOwnsListKey({ appId: 'test-app', source: 'reco', listKey: 'hero-carousel' }));
});
