import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.AUTH_JWKS_URL ??= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.AUTH_JWT_ISSUER ??= 'https://example.supabase.co/auth/v1';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read","watch:read","taste-profile:read","taste-profile:write","recommendations:read","recommendations:write","profile-secrets:read","provider-connections:read","provider-tokens:read","provider-tokens:refresh","admin:diagnostics:read"],"status":"active"}]';
  process.env.ADMIN_UI_USER = 'admin-user';
  process.env.ADMIN_UI_PASSWORD = 'admin-pass';
  process.env.RECOMMENDATION_ENGINE_WORKER_BASE_URL = 'https://worker.example.com';
  process.env.RECOMMENDATION_ENGINE_WORKER_API_KEY = 'worker-key';
}

seedTestEnv();

test('admin ui requires basic auth and serves html when authorized', async (t) => {
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);

  t.after(async () => {
    await app.close();
  });

  const unauthorized = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers['www-authenticate'], 'Basic realm="Crispy Admin"');

  const authorized = await app.inject({
    method: 'GET',
    url: '/admin',
    headers: {
      authorization: `Basic ${Buffer.from('admin-user:admin-pass').toString('base64')}`,
    },
  });

  assert.equal(authorized.statusCode, 200);
  assert.match(String(authorized.headers['content-type']), /text\/html/);
  assert.match(authorized.body, /Crispy Control Plane/);
  assert.match(authorized.body, /Worker Jobs/);
});

test('admin api proxies worker jobs and diagnostics behind admin auth', async (t) => {
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');
  const { WorkerControlClient } = await import('../../modules/admin/worker-control-client.js');
  const { RecommendationAdminService } = await import('../../modules/recommendations/recommendation-admin.service.js');
  const { ProviderAdminService } = await import('../../modules/imports/provider-admin.service.js');
  const { ProviderImportService } = await import('../../modules/imports/provider-import.service.js');
  const { ProviderTokenAccessService } = await import('../../modules/imports/provider-token-access.service.js');
  const { AccountLookupService } = await import('../../modules/users/account-lookup.service.js');
  const { RecommendationDataService } = await import('../../modules/recommendations/recommendation-data.service.js');
  const { RecommendationOutputService } = await import('../../modules/recommendations/recommendation-output.service.js');

  const originalGetJobStatus = WorkerControlClient.prototype.getJobStatus;
  const originalTriggerJob = WorkerControlClient.prototype.triggerJob;
  const originalBridgeConfigured = WorkerControlClient.prototype.isConfigured;
  const originalGetWorkState = RecommendationAdminService.prototype.getWorkState;
  const originalGetOutbox = RecommendationAdminService.prototype.getOutbox;
  const originalListConnections = ProviderAdminService.prototype.listConnections;
  const originalImportListConnections = ProviderImportService.prototype.listConnections;
  const originalImportListJobs = ProviderImportService.prototype.listJobs;
  const originalStartReplaceImport = ProviderImportService.prototype.startReplaceImport;
  const originalGetConnectionForAccountProfile = ProviderTokenAccessService.prototype.getConnectionForAccountProfile;
  const originalGetTokenStatusForAccountProfile = ProviderTokenAccessService.prototype.getTokenStatusForAccountProfile;
  const originalGetAccessTokenForAccountProfile = ProviderTokenAccessService.prototype.getAccessTokenForAccountProfile;
  const originalGetByEmail = AccountLookupService.prototype.getByEmail;
  const originalListProfiles = RecommendationDataService.prototype.listAccountProfilesForService;
  const originalGetWatchHistory = RecommendationDataService.prototype.getWatchHistoryForAccountService;
  const originalGetContinueWatching = RecommendationDataService.prototype.getContinueWatchingForAccountService;
  const originalGetWatchlist = RecommendationDataService.prototype.getWatchlistForAccountService;
  const originalGetRatings = RecommendationDataService.prototype.getRatingsForAccountService;
  const originalGetTrackedSeries = RecommendationDataService.prototype.getTrackedSeriesForAccountService;
  const originalGetTaste = RecommendationOutputService.prototype.getTasteProfileForAccountService;
  const originalGetRecommendations = RecommendationOutputService.prototype.getRecommendationsForAccountService;

  t.after(() => {
    WorkerControlClient.prototype.getJobStatus = originalGetJobStatus;
    WorkerControlClient.prototype.triggerJob = originalTriggerJob;
    WorkerControlClient.prototype.isConfigured = originalBridgeConfigured;
    RecommendationAdminService.prototype.getWorkState = originalGetWorkState;
    RecommendationAdminService.prototype.getOutbox = originalGetOutbox;
    ProviderAdminService.prototype.listConnections = originalListConnections;
    ProviderImportService.prototype.listConnections = originalImportListConnections;
    ProviderImportService.prototype.listJobs = originalImportListJobs;
    ProviderImportService.prototype.startReplaceImport = originalStartReplaceImport;
    ProviderTokenAccessService.prototype.getConnectionForAccountProfile = originalGetConnectionForAccountProfile;
    ProviderTokenAccessService.prototype.getTokenStatusForAccountProfile = originalGetTokenStatusForAccountProfile;
    ProviderTokenAccessService.prototype.getAccessTokenForAccountProfile = originalGetAccessTokenForAccountProfile;
    AccountLookupService.prototype.getByEmail = originalGetByEmail;
    RecommendationDataService.prototype.listAccountProfilesForService = originalListProfiles;
    RecommendationDataService.prototype.getWatchHistoryForAccountService = originalGetWatchHistory;
    RecommendationDataService.prototype.getContinueWatchingForAccountService = originalGetContinueWatching;
    RecommendationDataService.prototype.getWatchlistForAccountService = originalGetWatchlist;
    RecommendationDataService.prototype.getRatingsForAccountService = originalGetRatings;
    RecommendationDataService.prototype.getTrackedSeriesForAccountService = originalGetTrackedSeries;
    RecommendationOutputService.prototype.getTasteProfileForAccountService = originalGetTaste;
    RecommendationOutputService.prototype.getRecommendationsForAccountService = originalGetRecommendations;
  });

  WorkerControlClient.prototype.isConfigured = function () {
    return true;
  };
  WorkerControlClient.prototype.getJobStatus = async function () {
    return {
      ok: true,
      activeJobs: [],
      queuedJobs: [{ id: 'job-queued', target: 'recommendations_daily', script: 'recommendations_daily.ts', args: [], status: 'queued', createdAt: '2026-03-25T00:00:00.000Z', startedAt: null, finishedAt: null, exitCode: null, pid: null, cancelRequestedAt: null, progress: { phase: 'Queued', message: 'waiting', current: 0, total: null, percent: null, processed: 0, skipped: 0, errors: 0, updatedAt: '2026-03-25T00:00:00.000Z' }, stdoutTail: [], stderrTail: [], queuePosition: 1 }],
      recentJobs: [],
      serverTime: '2026-03-25T00:00:00.000Z',
    } as never;
  };
  WorkerControlClient.prototype.triggerJob = async function (input) {
    return { ok: true, queued: false, message: `triggered:${input.target}` } as never;
  };
  RecommendationAdminService.prototype.getWorkState = async function () {
    return { activeLeases: [], staleLeases: [], backlog: [{ sourceKey: 'default', pendingCount: 2, activeLeaseCount: 1, oldestPendingAt: '2026-03-24T00:00:00.000Z' }] } as never;
  };
  RecommendationAdminService.prototype.getOutbox = async function () {
    return { lag: { undeliveredCount: 1, oldestUndeliveredAt: '2026-03-24T01:00:00.000Z' }, undelivered: [] } as never;
  };
  ProviderAdminService.prototype.listConnections = async function () {
    return { connections: [{ accountId: 'account-1', profileId: 'profile-1', provider: 'trakt', status: 'connected', externalUsername: 'demo', providerUserId: 'user-1', accessTokenExpiresAt: '2026-03-30T00:00:00.000Z', refreshFailureCount: 0 }] } as never;
  };
  ProviderImportService.prototype.listConnections = async function () {
    return {
      connections: [{ id: 'conn-1', provider: 'trakt', status: 'connected', providerUserId: 'user-1', externalUsername: 'demo', createdAt: '2026-03-24T00:00:00.000Z', updatedAt: '2026-03-25T00:00:00.000Z', lastUsedAt: null, lastImportJobId: 'job-1', lastImportCompletedAt: '2026-03-25T00:00:00.000Z' }],
      watchDataState: { profileId: 'profile-1', historyGeneration: 4, currentOrigin: 'trakt_import', lastImportProvider: 'trakt', lastImportJobId: 'job-1', lastResetAt: null, lastImportCompletedAt: '2026-03-25T00:00:00.000Z', updatedAt: '2026-03-25T00:00:00.000Z' },
    } as never;
  };
  ProviderImportService.prototype.listJobs = async function () {
    return {
      jobs: [{ id: 'job-1', profileId: 'profile-1', provider: 'trakt', mode: 'replace_import', status: 'succeeded', requestedByUserId: 'account-1', connectionId: 'conn-1', checkpointJson: {}, summaryJson: {}, errorJson: {}, createdAt: '2026-03-24T00:00:00.000Z', startedAt: '2026-03-24T00:01:00.000Z', finishedAt: '2026-03-24T00:02:00.000Z', updatedAt: '2026-03-24T00:02:00.000Z' }],
      watchDataState: { profileId: 'profile-1', historyGeneration: 4, currentOrigin: 'trakt_import', lastImportProvider: 'trakt', lastImportJobId: 'job-1', lastResetAt: null, lastImportCompletedAt: '2026-03-25T00:00:00.000Z', updatedAt: '2026-03-25T00:00:00.000Z' },
    } as never;
  };
  ProviderImportService.prototype.startReplaceImport = async function (_accountId, _profileId, provider) {
    return {
      nextAction: 'queued',
      authUrl: null,
      watchDataState: { profileId: 'profile-1', historyGeneration: 5, currentOrigin: 'trakt_import', lastImportProvider: provider, lastImportJobId: 'job-2', lastResetAt: null, lastImportCompletedAt: '2026-03-25T00:00:00.000Z', updatedAt: '2026-03-25T00:00:00.000Z' },
      connection: { id: 'conn-1', profileId: 'profile-1', provider, status: 'connected', providerUserId: 'user-1', externalUsername: 'demo', createdAt: '2026-03-24T00:00:00.000Z', updatedAt: '2026-03-25T00:00:00.000Z', lastUsedAt: null, credentialsJson: { lastImportJobId: 'job-2', lastImportCompletedAt: '2026-03-25T00:00:00.000Z' } },
      job: { id: 'job-2', profileId: 'profile-1', profileGroupId: 'group-1', provider, mode: 'replace_import', status: 'queued', requestedByUserId: 'account-1', connectionId: 'conn-1', checkpointJson: {}, summaryJson: {}, errorJson: {}, createdAt: '2026-03-25T00:00:00.000Z', startedAt: null, finishedAt: null, updatedAt: '2026-03-25T00:00:00.000Z' },
    } as never;
  };
  ProviderTokenAccessService.prototype.getConnectionForAccountProfile = async function (_accountId, profileId, provider) {
    return { connectionId: 'conn-1', profileId, provider, status: 'connected', providerUserId: 'user-1', externalUsername: 'demo', createdAt: '2026-03-24T00:00:00.000Z', updatedAt: '2026-03-25T00:00:00.000Z', lastUsedAt: null, accessTokenExpiresAt: '2026-03-30T00:00:00.000Z', hasAccessToken: true, hasRefreshToken: true, lastRefreshAt: '2026-03-25T00:00:00.000Z', lastRefreshError: null, recommendedRefreshDelayMs: null } as never;
  };
  ProviderTokenAccessService.prototype.getTokenStatusForAccountProfile = async function (_accountId, profileId, provider) {
    return { connectionId: 'conn-1', profileId, provider, tokenState: 'valid', accessTokenExpiresAt: '2026-03-30T00:00:00.000Z', hasAccessToken: true, canRefresh: true, lastRefreshAt: '2026-03-25T00:00:00.000Z', lastRefreshError: null, recommendedRefreshDelayMs: null } as never;
  };
  ProviderTokenAccessService.prototype.getAccessTokenForAccountProfile = async function (_accountId, profileId, provider, options) {
    return { connectionId: 'conn-1', profileId, provider, accessToken: options?.forceRefresh ? 'forced-token' : 'token', accessTokenExpiresAt: '2026-03-30T00:00:00.000Z', refreshed: options?.forceRefresh === true } as never;
  };
  AccountLookupService.prototype.getByEmail = async function (email) {
    return { accountId: 'account-1', email } as never;
  };
  RecommendationDataService.prototype.listAccountProfilesForService = async function () {
    return [{ id: 'profile-1', accountId: 'account-1', name: 'Me', isKids: false, updatedAt: '2026-03-25T00:00:00.000Z' }] as never;
  };
  RecommendationDataService.prototype.getWatchHistoryForAccountService = async function (accountId, profileId, limit) {
    return [{ accountId, profileId, limit }] as never;
  };
  RecommendationDataService.prototype.getContinueWatchingForAccountService = async function (accountId, profileId, limit) {
    return [{ accountId, profileId, limit, lastActivityAt: '2026-03-25T00:00:00.000Z', progress: { progressPercent: 50 } }] as never;
  };
  RecommendationDataService.prototype.getWatchlistForAccountService = async function (accountId, profileId, limit) {
    return [{ accountId, profileId, limit, addedAt: '2026-03-25T00:00:00.000Z' }] as never;
  };
  RecommendationDataService.prototype.getRatingsForAccountService = async function (accountId, profileId, limit) {
    return [{ accountId, profileId, limit, rating: { value: 8, ratedAt: '2026-03-25T00:00:00.000Z' } }] as never;
  };
  RecommendationDataService.prototype.getTrackedSeriesForAccountService = async function (accountId, profileId, limit) {
    return [{ accountId, profileId, limit, reason: 'continue_watching', show: { title: 'Demo Show' } }] as never;
  };
  RecommendationOutputService.prototype.getTasteProfileForAccountService = async function (accountId, profileId, sourceKey) {
    return { accountId, profileId, sourceKey } as never;
  };
  RecommendationOutputService.prototype.getRecommendationsForAccountService = async function (accountId, profileId, sourceKey, algorithmVersion) {
    return { accountId, profileId, sourceKey, algorithmVersion, sections: [{ title: 'Top picks', items: [] }] } as never;
  };

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminApiRoutes(app);
  t.after(async () => {
    await app.close();
  });

  const authHeader = {
    authorization: `Basic ${Buffer.from('admin-user:admin-pass').toString('base64')}`,
  };

  const bridge = await app.inject({ method: 'GET', url: '/admin/api/worker/control-status', headers: authHeader });
  assert.equal(bridge.statusCode, 200);
  assert.equal(bridge.json().workerControl.configured, true);
  assert.equal(bridge.json().workerControl.reachable, true);

  const jobs = await app.inject({ method: 'GET', url: '/admin/api/worker/jobs/status', headers: authHeader });
  assert.equal(jobs.statusCode, 200);
  assert.equal(jobs.json().queuedJobs[0].id, 'job-queued');

  const trigger = await app.inject({
    method: 'POST',
    url: '/admin/api/worker/jobs/trigger',
    headers: authHeader,
    payload: { target: 'recommendations_daily', options: { all: true } },
  });
  assert.equal(trigger.statusCode, 200);
  assert.equal(trigger.json().message, 'triggered:recommendations_daily');

  const workState = await app.inject({ method: 'GET', url: '/admin/api/diagnostics/recommendations/work-state?limit=5', headers: authHeader });
  assert.equal(workState.statusCode, 200);
  assert.equal(workState.json().backlog[0].pendingCount, 2);

  const imports = await app.inject({ method: 'GET', url: '/admin/api/diagnostics/imports/connections?limit=5', headers: authHeader });
  assert.equal(imports.statusCode, 200);
  assert.equal(imports.json().connections[0].provider, 'trakt');

  const lookup = await app.inject({ method: 'GET', url: '/admin/api/accounts/lookup-by-email/test@example.com', headers: authHeader });
  assert.equal(lookup.statusCode, 200);
  assert.equal(lookup.json().account.accountId, 'account-1');

  const profiles = await app.inject({ method: 'GET', url: '/admin/api/accounts/account-1/profiles', headers: authHeader });
  assert.equal(profiles.statusCode, 200);
  assert.equal(profiles.json().profiles[0].id, 'profile-1');

  const watchHistory = await app.inject({ method: 'GET', url: '/admin/api/accounts/account-1/profiles/profile-1/watch-history?limit=3', headers: authHeader });
  assert.equal(watchHistory.statusCode, 200);
  assert.equal(watchHistory.json().items[0].limit, 3);

  const taste = await app.inject({ method: 'GET', url: '/admin/api/accounts/account-1/profiles/profile-1/taste-profile?sourceKey=default', headers: authHeader });
  assert.equal(taste.statusCode, 200);
  assert.equal(taste.json().tasteProfile.profileId, 'profile-1');

  const importsOverview = await app.inject({ method: 'GET', url: '/admin/api/accounts/account-1/profiles/profile-1/imports/overview', headers: authHeader });
  assert.equal(importsOverview.statusCode, 200);
  assert.equal(importsOverview.json().providers[0].provider, 'trakt');

  const startImport = await app.inject({
    method: 'POST',
    url: '/admin/api/accounts/account-1/profiles/profile-1/imports/start',
    headers: authHeader,
    payload: { provider: 'trakt' },
  });
  assert.equal(startImport.statusCode, 202);
  assert.equal(startImport.json().nextAction, 'queued');

  const refreshToken = await app.inject({ method: 'POST', url: '/admin/api/accounts/account-1/profiles/profile-1/providers/trakt/refresh-token', headers: authHeader });
  assert.equal(refreshToken.statusCode, 200);
  assert.equal(refreshToken.json().refreshed, true);
});

test('admin api worker control status shows unreachable worker separately from config', async (t) => {
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');
  const { WorkerControlClient } = await import('../../modules/admin/worker-control-client.js');

  const originalIsConfigured = WorkerControlClient.prototype.isConfigured;
  const originalGetJobStatus = WorkerControlClient.prototype.getJobStatus;

  t.after(() => {
    WorkerControlClient.prototype.isConfigured = originalIsConfigured;
    WorkerControlClient.prototype.getJobStatus = originalGetJobStatus;
  });

  WorkerControlClient.prototype.isConfigured = function () {
    return true;
  };
  WorkerControlClient.prototype.getJobStatus = async function () {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3000');
  };

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminApiRoutes(app);

  t.after(async () => {
    await app.close();
  });

  const authHeader = {
    authorization: `Basic ${Buffer.from('admin-user:admin-pass').toString('base64')}`,
  };

  const response = await app.inject({ method: 'GET', url: '/admin/api/worker/control-status', headers: authHeader });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().workerControl.configured, true);
  assert.equal(response.json().workerControl.reachable, false);
  assert.match(String(response.json().workerControl.error), /ECONNREFUSED/);
});
