import type { FastifyInstance } from 'fastify';
import type { AppAuditAction } from '../../modules/apps/app-audit.repo.js';
import type { AppAuditRepo } from '../../modules/apps/app-audit.repo.js';
import type { AppAuthService } from '../../modules/apps/app-auth.service.js';
import type { AppAuthorizationService } from '../../modules/apps/app-authorization.service.js';
import type { AppRateLimitService } from '../../modules/apps/app-rate-limit.service.js';
import type { AppSelfService } from '../../modules/apps/app-self.service.js';
import type { EligibleProfileChangeFeedService } from '../../modules/apps/eligible-profile-change-feed.service.js';
import type { EligibleProfileSnapshotService } from '../../modules/apps/eligible-profile-snapshot.types.js';
import type { ProfileEligibilityService } from '../../modules/apps/profile-eligibility.service.js';
import type { ProfileSignalBundleService, ProfileSignalInclude } from '../../modules/apps/profile-signal-bundle.types.js';
import type { ServiceRecommendationListService } from '../../modules/apps/service-recommendation-list.service.js';
import type { RecommendationRunService } from '../../modules/apps/recommendation-run.service.js';
import type { RecommendationBatchService } from '../../modules/apps/recommendation-batch.service.js';
import type { RecommendationBackfillService } from '../../modules/apps/recommendation-backfill.service.js';
import { AccountLookupService } from '../../modules/users/account-lookup.service.js';
import { RecommendationDataService } from '../../modules/recommendations/recommendation-data.service.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import type { AppPrincipal, AppScope } from '../../modules/apps/app-principal.types.js';
import { success, mutation } from '../response.js';
import {
  eligibleProfileChangesRouteSchema,
  createEligibleProfileSnapshotRouteSchema,
  getEligibleProfileSnapshotItemsRouteSchema,
  profileEligibilityRouteSchema,
  profileSignalBundleRouteSchema,
  serviceRecommendationListsRouteSchema,
  upsertServiceRecommendationListRouteSchema,
  accountListUpsertRouteSchema,
  batchUpsertRouteSchema,
  createRecommendationRunRouteSchema,
  updateRecommendationRunRouteSchema,
  createRecommendationBatchRouteSchema,
  updateRecommendationBatchRouteSchema,
  backfillAssignmentsRouteSchema,
  appAuditEventsRouteSchema,
  createAuditEventRouteSchema,
  accountLookupRouteSchema,
  appSelfRouteSchema,
} from '../contracts/internal-apps.js';


type ProfileOwnershipValidator = Pick<ProfileService, 'requireOwnedProfile' | 'requireProfileOwnerAccountId'>;

export interface InternalAppsRoutesDeps {
  appAuthService: AppAuthService;
  appAuthorizationService: AppAuthorizationService;
  appRateLimitService: AppRateLimitService;
  appSelfService: AppSelfService;
  profileEligibilityService: ProfileEligibilityService;
  eligibleProfileChangeFeedService: EligibleProfileChangeFeedService;
  eligibleProfileSnapshotService: EligibleProfileSnapshotService;
  profileSignalBundleService: ProfileSignalBundleService;
  serviceRecommendationListService: ServiceRecommendationListService;
  recommendationRunService: RecommendationRunService;
  recommendationBatchService: RecommendationBatchService;
  recommendationBackfillService: RecommendationBackfillService;
  appAuditRepo: AppAuditRepo;
  profileService?: ProfileOwnershipValidator;
}

function hasScopedAllAccountAccess(principal: AppPrincipal, scope: AppScope): boolean {
  return principal.appId === 'official-recommender' && principal.scopes.includes(scope);
}

export async function registerInternalAppsRoutes(app: FastifyInstance, deps: InternalAppsRoutesDeps): Promise<void> {
  const accountLookupService = new AccountLookupService();
  const recommendationDataService = new RecommendationDataService();
  const profileService = deps.profileService ?? new ProfileService();

  app.get('/internal/apps/v1/me', { schema: appSelfRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    deps.appAuthorizationService.requireScope({ principal, scope: 'apps:self:read' });
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'apps.self' });
    return success(await deps.appSelfService.getAppSelf(principal), request);
  });

  app.get('/internal/apps/v1/profiles/eligible/changes', { schema: eligibleProfileChangesRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.eligible.changes' });
    const query = request.query as { cursor?: string; limit?: string; reason?: string; accountId?: string; profileId?: string };
    return success(await deps.eligibleProfileChangeFeedService.listChanges({
      principal,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : undefined,
      reason: query.reason as Parameters<EligibleProfileChangeFeedService['listChanges']>[0]['reason'],
      accountId: query.accountId,
      profileId: query.profileId,
    }), request);
  });

  app.post('/internal/apps/v1/profiles/eligible/snapshots', { schema: createEligibleProfileSnapshotRouteSchema }, async (request, reply) => {
    const principal = await app.requireRecommenderAuth(request);
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.eligible.snapshots' });
    const result = await deps.eligibleProfileSnapshotService.createSnapshot({
      principal,
      request: request.body as Parameters<EligibleProfileSnapshotService['createSnapshot']>[0]['request'],
    });
    reply.code(201);
    return mutation(result as Record<string, unknown>, request);
  });

  app.get('/internal/apps/v1/profiles/eligible/snapshots/:snapshotId/items', { schema: getEligibleProfileSnapshotItemsRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.eligible.snapshots' });
    const params = request.params as { snapshotId: string };
    const query = request.query as { cursor?: string; limit?: string; leaseSeconds?: string };
    return success(await deps.eligibleProfileSnapshotService.listItems({
      principal,
      snapshotId: params.snapshotId,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : undefined,
      leaseSeconds: query.leaseSeconds ? Number(query.leaseSeconds) : undefined,
    }), request);
  });

  app.get('/internal/apps/v1/accounts/:accountId/profiles/:profileId/eligibility', { schema: profileEligibilityRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    const hasAllAccountRead = hasScopedAllAccountAccess(principal, 'accounts:all:read');
    if (!hasAllAccountRead) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.eligible.changes', accountId: params.accountId, profileId: params.profileId });
    return success(await deps.profileEligibilityService.check({
      principal,
      accountId: params.accountId,
      profileId: params.profileId,
      purpose: 'recommendation-generation',
    }), request);
  });

  app.get('/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/recommendation-bundle', { schema: profileSignalBundleRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    const query = request.query as { include?: string; historyLimit?: string; ratingsLimit?: string; watchlistLimit?: string; continueLimit?: string; since?: string };
    const hasAllAccountRead = hasScopedAllAccountAccess(principal, 'accounts:all:read');
    if (!hasAllAccountRead) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.signals', accountId: params.accountId, profileId: params.profileId });
    return success(await deps.profileSignalBundleService.getBundle({
      principal,
      accountId: params.accountId,
      profileId: params.profileId,
      purpose: 'recommendation-generation',
      include: query.include ? query.include.split(',').map((item) => item.trim()).filter(Boolean) as ProfileSignalInclude[] : undefined,
      limits: {
        historyLimit: query.historyLimit ? Number(query.historyLimit) : undefined,
        ratingsLimit: query.ratingsLimit ? Number(query.ratingsLimit) : undefined,
        watchlistLimit: query.watchlistLimit ? Number(query.watchlistLimit) : undefined,
        continueLimit: query.continueLimit ? Number(query.continueLimit) : undefined,
      },
      since: query.since ? new Date(query.since) : undefined,
    }), request);
  });

  app.get('/internal/apps/v1/accounts/lookup-by-email/:email/profiles', { schema: accountLookupRouteSchema }, async (request) => {
    await app.requireRecommenderAuth(request);
    const params = request.params as { email: string };
    const account = await accountLookupService.getByEmail(params.email);
    return success({
      account: {
        accountId: account.accountId,
        email: account.email,
      },
      profiles: await recommendationDataService.listAccountProfilesForService(account.accountId),
    }, request);
  });

  app.get('/internal/apps/v1/recommendations/service-lists', { schema: serviceRecommendationListsRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.service-lists' });
    return success(await deps.serviceRecommendationListService.listWritableLists({ principal }), request);
  });

  app.put('/internal/apps/v1/profiles/:profileId/recommendations', { schema: upsertServiceRecommendationListRouteSchema }, async (request, reply) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { profileId: string };
    const body = request.body as { listKey?: unknown; requestId?: unknown; jobId?: unknown; generatedAt?: unknown; algorithmVersion?: unknown; modelVersion?: unknown; inputBundleAsOf?: unknown; items?: Parameters<ServiceRecommendationListService['upsertList']>[0]['request']['items'] };
    const listKey = typeof body.listKey === 'string' && body.listKey.trim() ? body.listKey : 'for-you';
    const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
      ? request.headers['idempotency-key']
      : typeof body.requestId === 'string'
        ? body.requestId
        : '';
    const accountId = await profileService.requireProfileOwnerAccountId(params.profileId);
    const hasAllAccountWrite = hasScopedAllAccountAccess(principal, 'accounts:all:write');
    if (!hasAllAccountWrite) {
      await profileService.requireOwnedProfile(accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.single-write', accountId, profileId: params.profileId, listKey });
    const result = await deps.serviceRecommendationListService.upsertList({
      principal,
      accountId,
      profileId: params.profileId,
      listKey,
      idempotencyKey,
      request: { items: body.items ?? [] },
    });
    reply.code(result.idempotency.replayed ? 200 : 201);
    return mutation(result as unknown as Record<string, unknown>, request);
  });

  app.put('/internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey', { schema: accountListUpsertRouteSchema }, async (request, reply) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string; listKey: string };
    const idempotencyKey = typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined;
    const hasAllAccountWrite = hasScopedAllAccountAccess(principal, 'accounts:all:write');
    if (!hasAllAccountWrite) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.single-write', accountId: params.accountId, profileId: params.profileId, listKey: params.listKey });
    const result = await deps.serviceRecommendationListService.upsertList({
      principal,
      accountId: params.accountId,
      profileId: params.profileId,
      listKey: params.listKey,
      idempotencyKey: idempotencyKey ?? '',
      request: request.body as Parameters<ServiceRecommendationListService['upsertList']>[0]['request'],
    });
    reply.code(result.idempotency.replayed ? 200 : 201);
    return mutation(result as unknown as Record<string, unknown>, request);
  });

  app.post('/internal/apps/v1/recommendations/batch-upsert', { schema: batchUpsertRouteSchema }, async (request, reply) => {
    const principal = await app.requireRecommenderAuth(request);
    const idempotencyKey = typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined;
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.batch-write' });
    const result = await deps.serviceRecommendationListService.batchUpsert({
      principal,
      idempotencyKey: idempotencyKey ?? '',
      request: request.body as Parameters<ServiceRecommendationListService['batchUpsert']>[0]['request'],
    });
    return mutation(result as unknown as Record<string, unknown>, request);
  });

  app.post('/internal/apps/v1/recommendations/runs', { schema: createRecommendationRunRouteSchema }, async (request, reply) => {
    const principal = await app.requireRecommenderAuth(request);
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.runs' });
    const result = await deps.recommendationRunService.createRun({
      principal,
      request: request.body as Parameters<RecommendationRunService['createRun']>[0]['request'],
    });
    reply.code(201);
    return mutation(result as Record<string, unknown>, request);
  });

  app.patch('/internal/apps/v1/recommendations/runs/:runId', { schema: updateRecommendationRunRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { runId: string };
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.runs', runId: params.runId });
    return success(await deps.recommendationRunService.updateRun({
      principal,
      runId: params.runId,
      request: request.body as Parameters<RecommendationRunService['updateRun']>[0]['request'],
    }), request);
  });

  app.post('/internal/apps/v1/recommendations/runs/:runId/batches', { schema: createRecommendationBatchRouteSchema }, async (request, reply) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { runId: string };
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.batches', runId: params.runId });
    const result = await deps.recommendationBatchService.createBatch({
      principal,
      runId: params.runId,
      request: request.body as Parameters<RecommendationBatchService['createBatch']>[0]['request'],
    });
    reply.code(201);
    return mutation(result as Record<string, unknown>, request);
  });

  app.patch('/internal/apps/v1/recommendations/runs/:runId/batches/:batchId', { schema: updateRecommendationBatchRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { runId: string; batchId: string };
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.batches', runId: params.runId });
    return success(await deps.recommendationBatchService.updateBatch({
      principal,
      runId: params.runId,
      batchId: params.batchId,
      request: request.body as Parameters<RecommendationBatchService['updateBatch']>[0]['request'],
    }), request);
  });

  app.get('/internal/apps/v1/recommendations/backfills/assignments', { schema: backfillAssignmentsRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const query = request.query as { status?: Parameters<RecommendationBackfillService['getAssignments']>[0]['query']['status']; limit?: string; cursor?: string };
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.backfills' });
    return success(await deps.recommendationBackfillService.getAssignments({
      principal,
      query: {
        status: query.status,
        limit: query.limit ? Number(query.limit) : undefined,
        cursor: query.cursor,
      },
    }), request);
  });

  app.get('/internal/apps/v1/audit/events', { schema: appAuditEventsRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const query = request.query as { accountId?: string; profileId?: string; runId?: string; batchId?: string; cursor?: string; limit?: string };
    deps.appAuthorizationService.requireScope({ principal, scope: 'apps:audit:read' });
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'apps.audit' });
    return success(await deps.appAuditRepo.listForApp({
      appId: principal.appId,
      accountId: query.accountId,
      profileId: query.profileId,
      runId: query.runId,
      batchId: query.batchId,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : 50,
    }), request);
  });

  app.post('/internal/apps/v1/audit/events', { schema: createAuditEventRouteSchema }, async (request, reply) => {
    const principal = await app.requireRecommenderAuth(request);
    deps.appAuthorizationService.requireScope({ principal, scope: 'apps:audit:write' });
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'apps.audit' });
    const body = request.body as {
      eventType: string;
      accountId?: string;
      profileId?: string;
      resourceType?: string;
      resourceId?: string;
      action: string;
      outcome: 'success' | 'failure';
      metadata?: Record<string, unknown>;
    };
    await deps.appAuditRepo.insert({
      appId: principal.appId,
      keyId: principal.keyId,
      action: body.action as AppAuditAction,
      accountId: body.accountId ?? null,
      profileId: body.profileId ?? null,
      resourceType: body.resourceType ?? null,
      resourceId: body.resourceId ?? null,
      metadata: {
        eventType: body.eventType,
        outcome: body.outcome,
        ...body.metadata,
      },
    });
    reply.code(201);
    return mutation({ success: true }, request);
  });
}
