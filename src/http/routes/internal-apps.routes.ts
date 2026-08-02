import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppAuditAction } from '../../modules/apps/app-audit.repo.js';
import type { AppAuditRepo } from '../../modules/apps/app-audit.repo.js';
import type { AppAuthService } from '../../modules/apps/app-auth.service.js';
import type { AppAuthorizationService } from '../../modules/apps/app-authorization.service.js';
import type { AppRateLimitService } from '../../modules/apps/app-rate-limit.service.js';
import type { AppSelfService } from '../../modules/apps/app-self.service.js';
import type { EligibleProfileChangeFeedService } from '../../modules/apps/eligible-profile-change-feed.service.js';
import type { EligibleProfileSnapshotService } from '../../modules/apps/eligible-profile-snapshot.types.js';
import type { ProfileEligibilityService } from '../../modules/apps/profile-eligibility.service.js';
import type { ServiceRecommendationListService } from '../../modules/apps/service-recommendation-list.service.js';
import { LocalUserWatchService } from '../../modules/integrations/local-user-watch.service.js';
import { EpisodicFollowService } from '../../modules/watch/episodic-follow.service.js';
import { WatchCardHydrator } from '../../modules/watch/watch-card-hydrator.service.js';
import { RecommendationOutputService } from '../../modules/recommendations/recommendation-output.service.js';
import { withDbClient } from '../../lib/db.js';
import type { RecommendationRunService } from '../../modules/apps/recommendation-run.service.js';
import type { RecommendationBatchService } from '../../modules/apps/recommendation-batch.service.js';
import type { RecommendationBackfillService } from '../../modules/apps/recommendation-backfill.service.js';
import type { AppPrincipal, AppScope } from '../../modules/apps/app-principal.types.js';
import type { AuthActor } from '../../modules/auth/auth.types.js';
import { HttpError } from '../../lib/errors.js';
import { AccountLookupService } from '../../modules/users/account-lookup.service.js';
import { RecommendationDataService } from '../../modules/recommendations/recommendation-data.service.js';
import { ProfileLocalService } from '../../modules/profiles/profile-local.service.js';
import { success, mutation } from '../response.js';
import {
  eligibleProfileChangesRouteSchema,
  createEligibleProfileSnapshotRouteSchema,
  getEligibleProfileSnapshotItemsRouteSchema,
  profileEligibilityRouteSchema,
  profileSignalReadRouteSchema,
  profileMetaReadRouteSchema,
  tasteProfileReadRouteSchema,
  tasteProfileWriteRouteSchema,
  type TasteProfileWriteBody,
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


type ProfileOwnershipValidator = Pick<ProfileLocalService, 'requireOwnedProfile' | 'requireProfileOwnerAccountId'>;

export interface InternalAppsRoutesDeps {
  appAuthService: AppAuthService;
  appAuthorizationService: AppAuthorizationService;
  appRateLimitService: AppRateLimitService;
  appSelfService: AppSelfService;
  profileEligibilityService: ProfileEligibilityService;
  eligibleProfileChangeFeedService: EligibleProfileChangeFeedService;
  eligibleProfileSnapshotService: EligibleProfileSnapshotService;
  serviceRecommendationListService: ServiceRecommendationListService;
  recommendationRunService: RecommendationRunService;
  recommendationBatchService: RecommendationBatchService;
  recommendationBackfillService: RecommendationBackfillService;
  appAuditRepo: AppAuditRepo;
  profileService?: ProfileOwnershipValidator;
  /** Read service for per-signal watch routes. Defaults to LocalUserWatchService. */
  watchReadService?: Pick<LocalUserWatchService, 'listHistoryPage' | 'listRatingsPage' | 'listWatchlistPage' | 'listContinueWatchingPage' | 'getStates'>;
  /** Card hydrator for per-signal watch routes. Defaults to WatchCardHydrator. */
  watchCardHydrator?: Pick<WatchCardHydrator, 'hydrateItems'>;
  /** Read service for episodic-follow signal route. Defaults to EpisodicFollowService. */
  episodicFollowService?: Pick<EpisodicFollowService, 'listForProfile'>;
  /** Service for taste read/write signal routes. Defaults to RecommendationOutputService. */
  recommendationOutputService?: Pick<RecommendationOutputService, 'getTasteProfileForAccountService' | 'upsertTasteProfileForAccountService'>;
}

function hasScopedAllAccountAccess(principal: AppPrincipal, scope: AppScope): boolean {
  // System-wide all-account access is reserved for service apps that hold the
  // explicit scope. PAT-authenticated requests never carry app scopes, so per-
  // user (e.g. custom) pushes fall through to per-profile ownership checks.
  return principal.principalType === 'app' && principal.scopes.includes(scope);
}

const DEFAULT_RATE_LIMIT_POLICY = {
  profileChangesReadsPerMinute: 60,
  profileSignalReadsPerMinute: 60,
  recommendationWritesPerMinute: 60,
  batchWritesPerMinute: 10,
  configBundleReadsPerMinute: 60,
  runsPerHour: 10,
  snapshotsPerDay: 5,
  maxProfilesPerBatch: 100,
  maxItemsPerList: 100,
};

/**
 * Synthesize an `AppPrincipal` for the `custom` app from a PAT-authenticated
 * user. Per-user custom pushes (3rd-party custom services acting on behalf of
 * a user) authenticate via PAT (Bearer cp_pat_...); the principal is built
 * with appId='custom', no system-wide scopes (so hasScopedAllAccountAccess
 * returns false), and ownedSources=['custom'] so the downstream service
 * derives source='custom' on the pushed list. Ownership of accountId/profileId
 * is enforced by the route via requireOwnedProfile.
 */
function buildCustomPrincipalForUser(user: AuthActor): AppPrincipal {
  if (!user.appUserId) {
    throw new Error('PAT auth is missing appUserId; cannot build custom principal.');
  }
  return {
    principalType: 'app',
    appId: 'custom',
    keyId: `pat:${user.tokenId ?? user.appUserId}`,
    scopes: ['recommendations:service-lists:write'],
    grants: [],
    ownedSources: ['custom'],
    rateLimitPolicy: DEFAULT_RATE_LIMIT_POLICY,
    registryEntry: {
      appId: 'custom',
      name: 'Crispy Custom Lists Service',
      description: 'Per-user custom-list push (PAT-authenticated).',
      status: 'active',
      ownerTeam: 'crispy',
      allowedEnvironments: ['*'],
      principalType: 'service_app',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      disabledAt: undefined,
    },
  };
}

/**
 * Resolve the principal for the home-list upsert route.
 * - `Bearer cp_pat_...`: PAT path -> custom principal derived from the user
 *   actor. The PAT must carry the `recommendations:write` scope.
 * - Anything else: service-principal path via requireRecommenderAuth
 *   (reco/fallback apps).
 */
async function resolveHomeIngestPrincipal(app: FastifyInstance, request: FastifyRequest): Promise<AppPrincipal> {
  const header = request.headers.authorization?.trim() ?? '';
  if (header.startsWith('Bearer cp_pat_')) {
    await app.requireAuth(request);
    app.requireScopes(request, ['recommendations:write']);
    const actor = app.requireUserActor(request) as AuthActor;
    return buildCustomPrincipalForUser(actor);
  }
  return app.requireRecommenderAuth(request);
}

export async function registerInternalAppsRoutes(app: FastifyInstance, deps: InternalAppsRoutesDeps): Promise<void> {
  const accountLookupService = new AccountLookupService();
  const recommendationDataService = new RecommendationDataService();
  const profileService = deps.profileService ?? new ProfileLocalService();

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

  // ── Per-signal read routes (reco pulls each signal individually) ───────
  //    These mirror the public /v1/profiles/:profileId/watch/* routes but
  //    accept any (accountId, profileId) when the caller holds
  //    accounts:all:read (reco). Same ClientMediaCard envelope, same
  //    paginated shape — the unified WatchCardHydrator runs on every read path,
  //    so reco (worker and webui) and the public client app consume the same
  //    card shape.
  //
  //    No per-consumer enrichment layer exists on the reco side; cards are
  //    rendered as-is.

  const watchReadService = deps.watchReadService ?? new LocalUserWatchService();
  const watchCardHydrator = deps.watchCardHydrator ?? new WatchCardHydrator();
  const episodicFollowService = deps.episodicFollowService ?? new EpisodicFollowService();
  const recommendationOutputService = deps.recommendationOutputService ?? new RecommendationOutputService();
  const usingInjectedWatchReadService = deps.watchReadService !== undefined;
  // When test deps inject a fake watchReadService, skip the withDbClient
  // wrapper (the fake doesn't need a real Postgres client).
  const runWithClient = <T>(work: (client: import('../../lib/db.js').DbClient) => Promise<T>): Promise<T> =>
    usingInjectedWatchReadService ? work({} as import('../../lib/db.js').DbClient) : withDbClient(work);

  app.get('/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/profile-meta', { schema: profileMetaReadRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    if (!hasScopedAllAccountAccess(principal, 'accounts:all:read')) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.signals', accountId: params.accountId, profileId: params.profileId });
    const profile = await profileService.requireOwnedProfile(params.accountId, params.profileId);
    return success({
      profileName: profile.name,
      isKids: profile.isKids,
      language: profile.interfaceLanguage ?? null,
      region: profile.region ?? null,
      watchDataOrigin: 'internal',
    }, request);
  });

  app.get('/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/watch/history', { schema: profileSignalReadRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    const query = request.query as { limit?: string; cursor?: string };
    if (!hasScopedAllAccountAccess(principal, 'accounts:all:read')) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.signals', accountId: params.accountId, profileId: params.profileId });
    const page = await watchReadService.listHistoryPage({
      accountId: params.accountId,
      profileId: params.profileId,
      limit: query.limit ? Number(query.limit) : 100,
      cursor: query.cursor ?? null,
    });
    const cards = page.items.length
      ? await runWithClient((client) => watchCardHydrator.hydrateItems(client, page.items))
      : [];
    return success({ Items: cards, StartIndex: 0, TotalRecordCount: cards.length, NextCursor: page.pageInfo.nextCursor, HasMore: page.pageInfo.hasMore }, request);
  });

  app.get('/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/watch/ratings', { schema: profileSignalReadRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    const query = request.query as { limit?: string; cursor?: string };
    if (!hasScopedAllAccountAccess(principal, 'accounts:all:read')) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.signals', accountId: params.accountId, profileId: params.profileId });
    const page = await watchReadService.listRatingsPage({
      accountId: params.accountId,
      profileId: params.profileId,
      limit: query.limit ? Number(query.limit) : 100,
      cursor: query.cursor ?? null,
    });
    const cards = page.items.length
      ? await runWithClient((client) => watchCardHydrator.hydrateItems(client, page.items))
      : [];
    return success({ Items: cards, StartIndex: 0, TotalRecordCount: cards.length, NextCursor: page.pageInfo.nextCursor, HasMore: page.pageInfo.hasMore }, request);
  });

  app.get('/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/watch/watchlist', { schema: profileSignalReadRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    const query = request.query as { limit?: string; cursor?: string };
    if (!hasScopedAllAccountAccess(principal, 'accounts:all:read')) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.signals', accountId: params.accountId, profileId: params.profileId });
    const page = await watchReadService.listWatchlistPage({
      accountId: params.accountId,
      profileId: params.profileId,
      limit: query.limit ? Number(query.limit) : 50,
      cursor: query.cursor ?? null,
    });
    const cards = page.items.length
      ? await runWithClient((client) => watchCardHydrator.hydrateItems(client, page.items))
      : [];
    return success({ Items: cards, StartIndex: 0, TotalRecordCount: cards.length, NextCursor: page.pageInfo.nextCursor, HasMore: page.pageInfo.hasMore }, request);
  });

  app.get('/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/watch/continue-watching', { schema: profileSignalReadRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    const query = request.query as { limit?: string; cursor?: string };
    if (!hasScopedAllAccountAccess(principal, 'accounts:all:read')) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.signals', accountId: params.accountId, profileId: params.profileId });
    const page = await watchReadService.listContinueWatchingPage({
      accountId: params.accountId,
      profileId: params.profileId,
      limit: query.limit ? Number(query.limit) : 20,
      cursor: query.cursor ?? null,
    });
    const cards = page.items.length
      ? await runWithClient((client) => watchCardHydrator.hydrateItems(client, page.items))
      : [];
    return success({ Items: cards, StartIndex: 0, TotalRecordCount: cards.length, NextCursor: page.pageInfo.nextCursor, HasMore: page.pageInfo.hasMore }, request);
  });

  app.get('/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/watch/episodic-follow', { schema: profileSignalReadRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    const query = request.query as { limit?: string };
    if (!hasScopedAllAccountAccess(principal, 'accounts:all:read')) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.signals', accountId: params.accountId, profileId: params.profileId });
    const items = await runWithClient((client) => episodicFollowService.listForProfile(client, params.profileId, query.limit ? Number(query.limit) : 20));
    return success({ Items: items, StartIndex: 0, TotalRecordCount: items.length, NextCursor: null, HasMore: false }, request);
  });

  // ── Taste profile read (GET) + write-back (PUT) ───────────────────────
  //    Reco reads a previously stored taste here and pushes a refreshed one
  //    back via PUT, using the same taste_profiles table as the public
  //    /v1/.../taste-profile route. Both routes go through the existing
  //    ...ForAccountService methods of RecommendationOutputService which
  //    resolve cross-account access via requireOwnedProfileForAccount.

  app.get('/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/taste', { schema: tasteProfileReadRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    const query = request.query as { sourceKey?: string };
    if (!hasScopedAllAccountAccess(principal, 'accounts:all:read')) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'profiles.signals', accountId: params.accountId, profileId: params.profileId });
    const sourceKey = typeof query.sourceKey === 'string' && query.sourceKey.trim() ? query.sourceKey : 'default';
    const tasteProfile = await recommendationOutputService.getTasteProfileForAccountService(params.accountId, params.profileId, sourceKey);
    return success({ tasteProfile }, request);
  });

  app.put('/internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/taste', { schema: tasteProfileWriteRouteSchema }, async (request) => {
    const principal = await app.requireRecommenderAuth(request);
    const params = request.params as { accountId: string; profileId: string };
    if (!hasScopedAllAccountAccess(principal, 'accounts:all:write')) {
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.single-write', accountId: params.accountId, profileId: params.profileId });
    const body = request.body as TasteProfileWriteBody;
    const tasteProfile = await recommendationOutputService.upsertTasteProfileForAccountService(params.accountId, params.profileId, {
      ...body,
      updatedById: principal.keyId ?? null,
    });
    return success({ tasteProfile }, request);
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

  app.put('/internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey', { schema: accountListUpsertRouteSchema }, async (request, reply) => {
    const principal = await resolveHomeIngestPrincipal(app, request);
    const params = request.params as { accountId: string; profileId: string; listKey: string };
    const idempotencyKey = typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined;
    const hasAllAccountWrite = hasScopedAllAccountAccess(principal, 'accounts:all:write');
    if (!hasAllAccountWrite) {
      if (principal.appId === 'custom' && request.auth?.type === 'pat') {
        // PAT-authenticated custom push: enforce that the URL :accountId is
        // the PAT owner's own account before delegating to per-profile ownership.
        const owner = (request.auth as AuthActor).appUserId;
        if (owner !== params.accountId) {
          throw new HttpError(403, 'Custom push accountId must match the authenticated user.');
        }
      }
      await profileService.requireOwnedProfile(params.accountId, params.profileId);
    }
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.single-write', accountId: params.accountId, profileId: params.profileId, listKey: params.listKey });
    const body = request.body as Record<string, unknown>;
    const result = await deps.serviceRecommendationListService.upsertList({
      principal,
      accountId: params.accountId,
      profileId: params.profileId,
      listKey: params.listKey,
      idempotencyKey: idempotencyKey ?? '',
      request: body as unknown as Parameters<ServiceRecommendationListService['upsertList']>[0]['request'],
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
