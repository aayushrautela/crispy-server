import test from 'node:test';
import assert from 'node:assert/strict';
import { DefaultServiceRecommendationListService } from './service-recommendation-list.service.js';
import type { AppAuditEventRecord, AppAuditRepo, CreateAppAuditEventInput, PaginatedAppAuditEvents } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { AppGrant, AppGrantAction, AppGrantResourceType, AppPrincipal, AppPurpose, AppScope } from './app-principal.types.js';
import type { ProfileEligibilityService } from './profile-eligibility.service.js';
import type { ServiceRecommendationListRepo } from './service-recommendation-list.repo.js';
import type { HomeWriteService } from '../home/home-write.service.js';
import { HttpError } from '../../lib/errors.js';

function buildPrincipal(scopes: AppScope[] = ['recommendations:service-lists:write', 'recommendations:service-lists:batch-write']): AppPrincipal {
  return {
    principalType: 'app',
    appId: 'test-app',
    keyId: 'test-key',
    scopes,
    grants: [],
    ownedSources: ['reco'],
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

class FakeHomeWriteService implements HomeWriteService {
  writes: Parameters<HomeWriteService['writeHome']>[0][] = [];
  async writeHome(input: Parameters<HomeWriteService['writeHome']>[0]) {
    this.writes.push(input);
    return { accountId: input.accountId, profileId: input.profileId, source: 'reco' as const, status: 'written' as const, listsWritten: input.lists.length, itemCount: input.lists.reduce((sum, list) => sum + list.items.length, 0), lists: input.lists.map((list, index) => ({ listId: `list-${index}`, sectionType: list.sectionType, title: list.title, itemCount: list.items.length, version: 1 })), idempotency: { key: input.idempotencyKey, replayed: false }, createdAt: new Date('2024-01-01T00:00:00.000Z') };
  }
  async clearHome(): Promise<import('../home/home-types.js').HomeWriteResult> { throw new Error('not used'); }
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
    items: providerIds.map((providerId) => ({ type: 'movie' as const, providerRefs: [{ provider: 'tmdb' as const, providerId }], score: null, metadata: {} })),
    model: null,
    context: {},
  };
}

function buildService() {
  const serviceListRepo = new FakeServiceListRepo();
  const homeWriteService = new FakeHomeWriteService();
  const appAuditRepo = new FakeAuditRepo();
  const service = new DefaultServiceRecommendationListService({
    serviceListRepo,
    homeWriteService,
    profileEligibilityService: eligibilityService,
    appAuthorizationService: new FakeAuthorizationService(),
    appAuditRepo,
    clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
    maxProfilesPerBatch: 10,
    maxListsPerProfile: 5,
  });
  return { service, serviceListRepo, homeWriteService, appAuditRepo };
}

test('upsertList normalizes item refs and delegates to the home writer', async () => {
  const { service, homeWriteService } = buildService();

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
  assert.equal(homeWriteService.writes.length, 1);
  const write = homeWriteService.writes[0];
  assert.ok(write);
  assert.equal(write.source, 'reco');
  assert.equal(write.accountId, 'acc-1');
  assert.equal(write.profileId, 'prof-1');
  assert.equal(write.idempotencyKey, 'idem-1');
  assert.equal(write.lists.length, 1);
  const list = write.lists[0];
  assert.ok(list);
  assert.equal(list.sectionType, 'contentRail');
  assert.deepEqual(list.title, 'For You');
  assert.deepEqual(list.items, [
    { type: 'movie', providerRefs: [{ provider: 'tmdb', providerId: '101' }] },
    { type: 'movie', providerRefs: [{ provider: 'tmdb', providerId: '102' }] },
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

test('batchUpsert normalizes list refs, derives per-profile idempotency, and writes all of a profile\'s lists in one atomic writeHome call', async () => {
  const { service, serviceListRepo, homeWriteService } = buildService();

  const result = await service.batchUpsert({
    principal: buildPrincipal(),
    idempotencyKey: 'batch-1',
    request: {
      profiles: [{
        accountId: 'acc-1',
        profileId: 'prof-1',
        lists: [
          { ...buildWriteRequest(['103']) },
          { ...buildWriteRequest(['104']) },
        ],
      }],
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.summary.listsWritten, 2);
  assert.equal(result.summary.itemsWritten, 2);
  assert.equal(serviceListRepo.savedBatchResultStatus, 'completed');
  assert.ok(serviceListRepo.savedBatchRequestHash);
  assert.equal(homeWriteService.writes.length, 1, 'all of a profile\'s lists must reach writeHome in a single atomic call');
  const batchWrite = homeWriteService.writes[0];
  assert.ok(batchWrite);
  assert.equal(batchWrite.idempotencyKey, 'batch-1:acc-1:prof-1');
  assert.equal(batchWrite.lists.length, 2);
  const firstList = batchWrite.lists[0];
  const secondList = batchWrite.lists[1];
  assert.ok(firstList);
  assert.ok(secondList);
  assert.deepEqual(firstList.items, [{ type: 'movie', providerRefs: [{ provider: 'tmdb', providerId: '103' }] }]);
  assert.deepEqual(secondList.items, [{ type: 'movie', providerRefs: [{ provider: 'tmdb', providerId: '104' }] }]);
});
