import Fastify from 'fastify';
import { loggerOptions } from '../config/logger.js';
import { db } from '../lib/db.js';
import adminUiAuthPlugin from './plugins/admin-ui-auth.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import serviceAuthPlugin from './plugins/service-auth.js';
import appAuthPlugin from './plugins/app-auth.plugin.js';
import { SqlAppRegistryRepo } from '../modules/apps/app-registry.repo.js';
import { SqlAppKeyRepo } from '../modules/apps/app-key.repo.js';
import { SqlAppGrantRepo } from '../modules/apps/app-grant.repo.js';
import { SqlAppSourceOwnershipRepo } from '../modules/apps/app-source-ownership.repo.js';
import { BcryptAppKeyHasher } from '../modules/apps/app-key-hasher.js';
import { DefaultAppAuthService } from '../modules/apps/app-auth.service.js';
import { DefaultAppRateLimitService, InMemoryRateLimitStore } from '../modules/apps/app-rate-limit.service.js';
import { SqlAppAuditRepo } from '../modules/apps/app-audit.repo.js';
import { SystemClock } from '../modules/apps/clock.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerAdminApiRoutes } from './routes/admin-api.js';
import { registerAdminUiRoutes } from './routes/admin-ui.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMeRoutes } from './routes/me.js';
import { registerMetadataRoutes } from './routes/metadata.js';
import { registerInternalAdminImportRoutes } from './routes/internal-admin-imports.js';
import { registerInternalAccountRoutes } from './routes/internal-accounts.js';
import { registerInternalAdminRecommendationRoutes } from './routes/internal-admin-recommendations.js';
import { registerInternalConfidentialRoutes } from './routes/internal-confidential.js';
import { ConfidentialConfigService } from '../modules/confidential/service.js';
import { registerPersonalAccessTokenRoutes } from './routes/personal-access-tokens.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerProfileSettingsRoutes } from './routes/profile-settings.js';
import { registerRecommendationOutputRoutes } from './routes/recommendation-outputs.js';
import { registerWatchRoutes } from './routes/watch.js';
import { registerAccountPublicRoutes } from './routes/account-public.routes.js';
import { registerInternalAppsRoutes } from './routes/internal-apps.routes.js';
import { DefaultAppSelfService } from '../modules/apps/app-self.service.js';
import { DefaultAppAuthorizationService } from '../modules/apps/app-authorization.service.js';
import { DefaultProfileEligibilityService } from '../modules/apps/profile-eligibility.service.js';
import { SqlProfileEligibilityRepo } from '../modules/apps/profile-eligibility.repo.js';
import { DefaultEligibleProfileChangeFeedService } from '../modules/apps/eligible-profile-change-feed.service.js';
import { SqlEligibleProfileChangeFeedRepo } from '../modules/apps/eligible-profile-change-feed.repo.js';
import { DefaultEligibleProfileSnapshotService } from '../modules/apps/eligible-profile-snapshot.service.js';
import { SqlEligibleProfileSnapshotRepo } from '../modules/apps/eligible-profile-snapshot.repo.js';
import { DefaultProfileSignalBundleService } from '../modules/apps/profile-signal-bundle.service.js';
import { SqlProfileSignalBundleRepo } from '../modules/apps/profile-signal-bundle.repo.js';
import { SignedAppCursorCodec } from '../modules/apps/app-cursor-codec.js';
import { SqlServiceRecommendationListRepo } from '../modules/apps/service-recommendation-list.repo.js';
import { DefaultServiceRecommendationListService } from '../modules/apps/service-recommendation-list.service.js';
import { SqlRecommendationListRepo } from '../modules/recommendations/recommendation-list.repo.js';
import { AppRecommendationWritePolicy } from '../modules/recommendations/recommendation-list-policy.js';
import { DefaultRecommendationListWriteService } from '../modules/recommendations/recommendation-list-write.service.js';
import { SqlRecommendationRunRepo } from '../modules/apps/recommendation-run.repo.js';
import { DefaultRecommendationRunService } from '../modules/apps/recommendation-run.service.js';
import { SqlRecommendationBatchRepo } from '../modules/apps/recommendation-batch.repo.js';
import { DefaultRecommendationBatchService } from '../modules/apps/recommendation-batch.service.js';
import { SqlRecommendationBackfillRepo } from '../modules/apps/recommendation-backfill.repo.js';
import { DefaultRecommendationBackfillService } from '../modules/apps/recommendation-backfill.service.js';
import { env } from '../config/env.js';
import type { AuthScope, UserAuthActor } from '../modules/auth/auth.types.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth(request: import('fastify').FastifyRequest): Promise<void>;
    requireServiceAuth(request: import('fastify').FastifyRequest): Promise<void>;
    requireUserActor(request: import('fastify').FastifyRequest): UserAuthActor;
    requireScopes(request: import('fastify').FastifyRequest, scopes: AuthScope[]): void;
  }
}

function buildAppAuthDependencies() {
  const clock = new SystemClock();
  const appRegistryRepo = new SqlAppRegistryRepo({ db });
  const appKeyRepo = new SqlAppKeyRepo({ db });
  const appGrantRepo = new SqlAppGrantRepo({ db });
  const sourceOwnershipRepo = new SqlAppSourceOwnershipRepo({ db });
  const appAuditRepo = new SqlAppAuditRepo({ db });
  const appAuthService = new DefaultAppAuthService({
    appRegistryRepo,
    appKeyRepo,
    appGrantRepo,
    sourceOwnershipRepo,
    keyHasher: new BcryptAppKeyHasher(),
    clock,
  });
  const appRateLimitService = new DefaultAppRateLimitService({
    store: new InMemoryRateLimitStore(),
    clock,
  });

  return { appAuthService, appRateLimitService, appAuditRepo, clock, sourceOwnershipRepo };
}

function buildInternalAppsRoutesDependencies(authDeps: ReturnType<typeof buildAppAuthDependencies>) {
  const appAuthorizationService = new DefaultAppAuthorizationService();
  const appSelfService = new DefaultAppSelfService();
  const profileEligibilityRepo = new SqlProfileEligibilityRepo({ db });
  const profileEligibilityService = new DefaultProfileEligibilityService({
    repo: profileEligibilityRepo,
    appAuthorizationService,
    clock: authDeps.clock,
  });
  const cursorCodec = new SignedAppCursorCodec({ secret: env.adminUiSessionSecret || 'dev-cursor-secret' });
  const eligibleProfileChangeFeedRepo = new SqlEligibleProfileChangeFeedRepo({ db });
  const eligibleProfileChangeFeedService = new DefaultEligibleProfileChangeFeedService({
    repo: eligibleProfileChangeFeedRepo,
    cursorCodec,
    profileEligibilityService,
    appAuthorizationService,
    appAuditRepo: authDeps.appAuditRepo,
    clock: authDeps.clock,
    maxLimit: 1000,
  });
  const eligibleProfileSnapshotRepo = new SqlEligibleProfileSnapshotRepo({ db });
  const eligibleProfileSnapshotService = new DefaultEligibleProfileSnapshotService({
    repo: eligibleProfileSnapshotRepo,
    cursorCodec,
    appAuthorizationService,
    appAuditRepo: authDeps.appAuditRepo,
    clock: authDeps.clock,
    maxSnapshotCreateLimit: 100000,
    maxSnapshotReadLimit: 500,
  });
  const profileSignalBundleRepo = new SqlProfileSignalBundleRepo({ db });
  const profileSignalBundleService = new DefaultProfileSignalBundleService({
    repo: profileSignalBundleRepo,
    profileEligibilityService,
    appAuthorizationService,
    appAuditRepo: authDeps.appAuditRepo,
    clock: authDeps.clock,
    defaults: {
      historyDefault: 100,
      historyMax: 500,
      ratingsDefault: 100,
      ratingsMax: 500,
      watchlistDefault: 50,
      watchlistMax: 200,
      continueDefault: 20,
      continueMax: 50,
      tasteGenresMax: 50,
      tastePeopleMax: 50,
      tasteKeywordsMax: 50,
    },
  });
  const recommendationListRepo = new SqlRecommendationListRepo({ db });
  const recommendationListWriteService = new DefaultRecommendationListWriteService({
    repo: recommendationListRepo,
    policy: new AppRecommendationWritePolicy({
      appAuthorizationService,
      sourceOwnershipRepo: authDeps.sourceOwnershipRepo,
      profileEligibilityService,
      maxItemsDefault: 100,
    }),
    appAuditRepo: authDeps.appAuditRepo,
    clock: authDeps.clock,
  });
  const serviceRecommendationListService = new DefaultServiceRecommendationListService({
    serviceListRepo: new SqlServiceRecommendationListRepo({ db }),
    recommendationListWriteService,
    profileEligibilityService,
    appAuthorizationService,
    appAuditRepo: authDeps.appAuditRepo,
    clock: authDeps.clock,
    maxProfilesPerBatch: 100,
    maxListsPerProfile: 5,
  });
  const recommendationRunRepo = new SqlRecommendationRunRepo({ db });
  const recommendationRunService = new DefaultRecommendationRunService({
    repo: recommendationRunRepo,
    appAuthorizationService,
    appAuditRepo: authDeps.appAuditRepo,
    clock: authDeps.clock,
  });
  const recommendationBatchService = new DefaultRecommendationBatchService({
    batchRepo: new SqlRecommendationBatchRepo({ db }),
    runRepo: recommendationRunRepo,
    appAuthorizationService,
    appAuditRepo: authDeps.appAuditRepo,
    clock: authDeps.clock,
  });
  const recommendationBackfillService = new DefaultRecommendationBackfillService({
    repo: new SqlRecommendationBackfillRepo({ db }),
    cursorCodec,
    appAuthorizationService,
    appAuditRepo: authDeps.appAuditRepo,
    maxLimit: 100,
  });

  return {
    appAuthService: authDeps.appAuthService,
    appAuthorizationService,
    appRateLimitService: authDeps.appRateLimitService,
    appSelfService,
    profileEligibilityService,
    eligibleProfileChangeFeedService,
    eligibleProfileSnapshotService,
    profileSignalBundleService,
    serviceRecommendationListService,
    recommendationRunService,
    recommendationBatchService,
    recommendationBackfillService,
    appAuditRepo: authDeps.appAuditRepo,
  };
}

function buildConfidentialConfigService(appDeps: ReturnType<typeof buildInternalAppsRoutesDependencies>) {
  return new ConfidentialConfigService({
    profileEligibilityService: appDeps.profileEligibilityService,
    appAuthorizationService: appDeps.appAuthorizationService,
    appAuditRepo: appDeps.appAuditRepo,
  });
}

export async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
  });

  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await app.register(authPlugin);
  await app.register(serviceAuthPlugin);
  const appAuthDeps = buildAppAuthDependencies();
  await app.register(appAuthPlugin, appAuthDeps);

  app.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    if (body === '') {
      return done(null, {});
    }
    try {
      const parsed = JSON.parse(body as string);
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await registerHealthRoutes(app);
  await registerAdminUiRoutes(app);
  await registerAdminApiRoutes(app);
  await registerAccountRoutes(app);
  await registerAiRoutes(app);
  await registerMeRoutes(app);
  await registerPersonalAccessTokenRoutes(app);
  await registerProfileRoutes(app);
  await registerProfileSettingsRoutes(app);
  await registerMetadataRoutes(app);
  await registerWatchRoutes(app);
  await registerRecommendationOutputRoutes(app);
  await registerInternalAccountRoutes(app);
  await registerInternalAdminRecommendationRoutes(app);
  await registerInternalAdminImportRoutes(app);
  const internalAppsDeps = buildInternalAppsRoutesDependencies(appAuthDeps);
  await registerInternalConfidentialRoutes(app, {
    confidentialConfigService: buildConfidentialConfigService(internalAppsDeps),
  });
  await registerCalendarRoutes(app);
  await registerAccountPublicRoutes(app);
  await registerInternalAppsRoutes(app, internalAppsDeps);

  return app;
}
