import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger, loggerOptions } from '../config/logger.js';
import { db } from '../lib/db.js';
import adminUiAuthPlugin from './plugins/admin-ui-auth.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
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
import { registerAvatarRoutes } from './routes/avatars.js';
import { registerMeRoutes } from './routes/me.js';
import { registerMetadataRoutes } from './routes/metadata.js';
import { registerPersonalAccessTokenRoutes } from './routes/personal-access-tokens.js';
import { PersonalAccessTokenService } from '../modules/auth/personal-access-token.service.js';
import { AppLoginHandoffService } from '../modules/auth/app-login-handoff.service.js';
import { registerAuthHandoffRoutes } from './routes/auth-handoff.js';
import { AccountSettingsService } from '../modules/users/account-settings.service.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerProfileSettingsRoutes } from './routes/profile-settings.js';
import { ProfileLocalService } from '../modules/profiles/profile-local.service.js';
import { ProfilePinService } from '../modules/profiles/profile-pin.service.js';
import { registerTasteProfileRoutes } from './routes/taste-profile.routes.js';
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
import { SignedAppCursorCodec } from '../modules/apps/app-cursor-codec.js';
import { SqlServiceRecommendationListRepo } from '../modules/apps/service-recommendation-list.repo.js';
import { DefaultServiceRecommendationListService } from '../modules/apps/service-recommendation-list.service.js';
import { HomeListsRepo } from '../modules/home/repos/home-lists.repo.js';
import { DefaultHomeWriteService } from '../modules/home/home-write.service.js';
import { ContentIdentityService } from '../modules/identity/content-identity.service.js';
import { RecommenderNotifier, getRecommenderNotifier } from '../modules/recommender-notifier/recommender-notifier.js';
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
    requireUserActor(request: import('fastify').FastifyRequest): UserAuthActor;
    requireScopes(request: import('fastify').FastifyRequest, scopes: AuthScope[]): void;
    recommenderNotifier: RecommenderNotifier | null;
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

  return { appAuthService, appRateLimitService, appAuditRepo, clock, sourceOwnershipRepo, appRegistryRepo, appGrantRepo };
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
  const cursorCodec = new SignedAppCursorCodec({ secret: env.cursorSigningSecret });
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
  const homeListsRepo = new HomeListsRepo({ db });
  const homeWriteService = new DefaultHomeWriteService({
    repo: homeListsRepo,
    contentIdentityService: new ContentIdentityService(),
    clock: authDeps.clock,
  });
  const serviceRecommendationListService = new DefaultServiceRecommendationListService({
    serviceListRepo: new SqlServiceRecommendationListRepo({ db }),
    homeWriteService,
    profileEligibilityService,
    appAuthorizationService,
    appAuditRepo: authDeps.appAuditRepo,
    clock: authDeps.clock,
    maxProfilesPerBatch: 100,
    maxListsPerProfile: 50,
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
    serviceRecommendationListService,
    recommendationRunService,
    recommendationBatchService,
    recommendationBackfillService,
    appAuditRepo: authDeps.appAuditRepo,
  };
}

export async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  await app.register(errorHandlerPlugin);
  await app.register(cors, {
    origin: env.corsOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    credentials: true,
  });
  await app.register(adminUiAuthPlugin);
  await app.register(authPlugin);
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

  const recommenderNotifier = getRecommenderNotifier();
  app.decorate('recommenderNotifier', recommenderNotifier);

  const profileService = new ProfileLocalService(recommenderNotifier);
  const profilePinService = new ProfilePinService();
  const accountSettingsService = new AccountSettingsService();
  const patService = new PersonalAccessTokenService();
  const appLoginHandoffService = new AppLoginHandoffService();

  await registerHealthRoutes(app);
  await registerAvatarRoutes(app);
  await registerAdminUiRoutes(app);
  await registerAccountRoutes(app, { accountSettingsService });
  await registerAiRoutes(app, { profilePinService });
  await registerMeRoutes(app, { profileService, accountSettingsService });
  await registerPersonalAccessTokenRoutes(app, { patService });
  await registerAuthHandoffRoutes(app, { appLoginHandoffService });
  await registerProfileRoutes(app, { profileService, pinService: profilePinService });
  await registerProfileSettingsRoutes(app, { profileService });
  await registerMetadataRoutes(app);
  await registerWatchRoutes(app, { profilePinService });
  await registerTasteProfileRoutes(app);
  const internalAppsDeps = buildInternalAppsRoutesDependencies(appAuthDeps);
  await registerAdminApiRoutes(app);
  await registerCalendarRoutes(app, { profilePinService });
  await registerAccountPublicRoutes(app);
  await registerInternalAppsRoutes(app, internalAppsDeps);
  return app;
}
