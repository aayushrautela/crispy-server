import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { getByokOpenRouterProvider, getServerAiProvider } from '../../config/app-config.js';
import { HttpError } from '../../lib/errors.js';
import { OpenAiCompatibleClient } from '../../modules/ai/openai-compatible.client.js';
import type { AiProviderFailureDetails, AiResolvedProviderConfig } from '../../modules/ai/ai.types.js';
import { RecommendationAdminService } from '../../modules/recommendations/recommendation-admin.service.js';
import {
  resolveRecommendationAlgorithmVersion,
  resolveRecommendationSourceKey,
} from '../../modules/recommendations/recommendation-config.js';
import { ProviderAdminService } from '../../modules/integrations/provider-admin.service.js';
import { ProviderImportService, parseImportProvider } from '../../modules/integrations/provider-import.service.js';
import { ProviderTokenAccessService } from '../../modules/integrations/provider-token-access.service.js';
import type {
  ProviderImportJobStatus,
  ProviderImportProvider,
} from '../../modules/integrations/provider-import.types.js';
import { isProviderImportProvider } from '../../modules/integrations/provider-import.types.js';
import { AccountLookupService } from '../../modules/users/account-lookup.service.js';
import { RecommendationDataService } from '../../modules/recommendations/recommendation-data.service.js';
import { RecommendationOutputService } from '../../modules/recommendations/recommendation-output.service.js';
import { ProfileInputSignalFacade } from '../../modules/recommendations/profile-input-signal.facade.js';
import { mapProviderImportJobAdminView, mapProviderImportJobView } from '../../modules/integrations/provider-import.views.js';
import { CalendarService } from '../../modules/calendar/calendar.service.js';
import { AccountSettingsService } from '../../modules/users/account-settings.service.js';
import { RecommendationOutboxService } from '../../modules/outbox/recommendation-outbox.service.js';
import { ServiceOutboxRepository, type ServiceOutboxEventStatus } from '../../modules/outbox/service-outbox.repo.js';
import { AdminBulkJobService } from '../../modules/admin-bulk-jobs/admin-bulk-job.service.js';
import type { AdminBulkJobScope, AdminBulkJobStatus, AdminBulkJobTargetInput } from '../../modules/admin-bulk-jobs/admin-bulk-job.types.js';
import { withTransaction } from '../../lib/db.js';

const JOB_STATUSES = new Set<ProviderImportJobStatus>([
  'oauth_pending',
  'queued',
  'running',
  'succeeded',
  'succeeded_with_warnings',
  'failed',
  'cancelled',
]);

export async function registerAdminApiRoutes(
  app: FastifyInstance,
  deps?: { profileInputSignalFacade?: ProfileInputSignalFacade },
): Promise<void> {
  const recommendationAdminService = new RecommendationAdminService();
  const providerAdminService = new ProviderAdminService();
  const providerImportService = new ProviderImportService();
  const providerTokenAccessService = new ProviderTokenAccessService();
  const accountLookupService = new AccountLookupService();
  const recommendationDataService = new RecommendationDataService();
  const recommendationOutputService = new RecommendationOutputService();
  const calendarService = new CalendarService();
  const accountSettingsService = new AccountSettingsService();
  const aiClient = new OpenAiCompatibleClient();
  const recommendationOutboxService = new RecommendationOutboxService();
  const serviceOutboxRepository = new ServiceOutboxRepository();
  const adminBulkJobService = new AdminBulkJobService();
  const profileInputSignalFacade = deps?.profileInputSignalFacade ?? new ProfileInputSignalFacade({
    defaults: {
      historyDefault: 25,
      historyMax: 100,
      ratingsDefault: 25,
      ratingsMax: 100,
      watchlistDefault: 25,
      watchlistMax: 100,
      continueDefault: 25,
      continueMax: 100,
      trackedSeriesDefault: 25,
      trackedSeriesMax: 100,
    },
  });

  async function requireAdmin(request: import('fastify').FastifyRequest): Promise<void> {
    const header = request.headers.authorization?.trim();
    if (header?.startsWith('Bearer ')) {
      try {
        await app.requireRecommenderAuth(request);
        return;
      } catch (error) {
        if (!(error instanceof HttpError) || error.statusCode !== 401) {
          throw error;
        }
      }
    }

    await app.requireAdminUi(request);
  }

  async function requireAdminMutation(request: import('fastify').FastifyRequest): Promise<void> {
    await app.requireAdminUiMutation(request);
  }

  app.get('/admin/api/recommendations/recompute-jobs/capabilities', async (request, reply) => {
    await requireAdmin(request);
    return {
      feature: {
        enabled: env.adminRecommendationRecomputeJobsEnabled,
        createEnabled: env.adminRecommendationRecomputeJobsCreateEnabled,
      },
      worker: {
        mode: env.adminBulkJobsWorkerMode,
        pollIntervalMs: env.adminBulkJobsPollIntervalMs,
        pollJitterMs: env.adminBulkJobsPollJitterMs,
        claimTtlMs: env.adminBulkJobsClaimTtlMs,
        shutdownTimeoutMs: env.adminBulkJobsShutdownTimeoutMs,
        maxConcurrentJobs: env.adminBulkJobsMaxConcurrentJobs,
      },
      allowedScopes: [
        { type: 'explicit_targets' },
        { type: 'all_users' },
        { type: 'tier', tiers: ['free', 'pro', 'ultra'] },
      ],
      limits: {
        enumerationPageSize: env.adminBulkJobsEnumerationPageSize,
        fanoutBatchSize: env.adminBulkJobsFanoutBatchSize,
      },
    };
  });

  app.post('/admin/api/recommendations/recompute-jobs/preview', async (request, reply) => {
    await requireAdmin(request);
    ensureRecomputeJobsEnabled();
    const body = asRecord(request.body);
    return adminBulkJobService.previewRecommendationRecomputeJob(parseBulkJobInput(body));
  });

  app.post('/admin/api/recommendations/recompute-jobs', async (request, reply) => {
    await requireAdminMutation(request);
    ensureRecomputeJobsEnabled();
    if (!env.adminRecommendationRecomputeJobsCreateEnabled) {
      throw new HttpError(403, 'Recommendation recompute job creation is disabled.');
    }
    const body = asRecord(request.body);
    const input = parseBulkJobInput(body);
    if (input.scope.type === 'all_users') {
      const confirmation = typeof body.confirmation === 'string' ? body.confirmation.trim() : '';
      if (confirmation !== 'RECOMPUTE_ALL_USERS') {
        throw new HttpError(400, 'confirmation must be RECOMPUTE_ALL_USERS for all-users recompute jobs.');
      }
    }
    const result = await adminBulkJobService.createRecommendationRecomputeJob(input);
    reply.code(result.created ? 202 : 200);
    return result;
  });

  app.get('/admin/api/recommendations/recompute-jobs', async (request, reply) => {
    await requireAdmin(request);
    ensureRecomputeJobsEnabled();
    const query = asRecord(request.query);
    return adminBulkJobService.listJobs({ status: parseBulkJobStatus(query.status), scope: parseBulkJobScopeFilter(query.scope), limit: parseBulkJobLimit(query.limit) });
  });

  app.get('/admin/api/recommendations/recompute-jobs/:jobId', async (request, reply) => {
    await requireAdmin(request);
    ensureRecomputeJobsEnabled();
    const params = asRecord(request.params);
    return adminBulkJobService.getJobDetail(readRequiredString(params.jobId, 'jobId'));
  });

  app.post('/admin/api/recommendations/recompute-jobs/:jobId/pause', async (request, reply) => {
    await requireAdminMutation(request);
    ensureRecomputeJobsEnabled();
    const params = asRecord(request.params);
    return adminBulkJobService.controlJob(readRequiredString(params.jobId, 'jobId'), 'pause');
  });

  app.post('/admin/api/recommendations/recompute-jobs/:jobId/resume', async (request, reply) => {
    await requireAdminMutation(request);
    ensureRecomputeJobsEnabled();
    const params = asRecord(request.params);
    return adminBulkJobService.controlJob(readRequiredString(params.jobId, 'jobId'), 'resume');
  });

  app.post('/admin/api/recommendations/recompute-jobs/:jobId/cancel', async (request, reply) => {
    await requireAdminMutation(request);
    ensureRecomputeJobsEnabled();
    const params = asRecord(request.params);
    return adminBulkJobService.controlJob(readRequiredString(params.jobId, 'jobId'), 'cancel');
  });

  app.post('/admin/api/recommendations/recompute-jobs/:jobId/reconcile', async (request, reply) => {
    await requireAdminMutation(request);
    ensureRecomputeJobsEnabled();
    const params = asRecord(request.params);
    return adminBulkJobService.reconcileJob(readRequiredString(params.jobId, 'jobId'));
  });

  app.get('/admin/api/diagnostics/recommendations/outbox', async (request, reply) => {
    await requireAdmin(request);
    const query = asRecord(request.query);
    return recommendationAdminService.getOutbox(parseLimit(query.limit));
  });

  app.get('/admin/api/diagnostics/recommendations/service-outbox', async (request, reply) => {
    await requireAdmin(request);
    const query = asRecord(request.query);
    const correlationId = typeof query.correlationId === 'string' && query.correlationId.trim() ? query.correlationId.trim() : null;
    const profileId = typeof query.profileId === 'string' && query.profileId.trim() ? query.profileId.trim() : null;
    const reason = typeof query.reason === 'string' && query.reason.trim() ? query.reason.trim() : null;
    const status = typeof query.status === 'string' && query.status.trim() ? query.status.trim() as ServiceOutboxEventStatus : null;
    const limit = parseLimit(query.limit);

    const events = await withTransaction(async (client) => {
      return serviceOutboxRepository.queryForDiagnostics(client, {
        correlationId,
        profileId,
        reason,
        status,
        limit,
      });
    });

    const summary = {
      total: events.length,
      pending: events.filter((e) => e.status === 'pending').length,
      processing: events.filter((e) => e.status === 'processing').length,
      dispatched: events.filter((e) => e.status === 'dispatched').length,
      failed: events.filter((e) => e.status === 'failed').length,
    };

    return {
      events: events.map((e) => ({
        id: e.id,
        profileId: e.profileId,
        userId: e.userId,
        bulkJobId: e.bulkJobId,
        bulkJobTargetId: e.bulkJobTargetId,
        reason: e.payload.reason,
        status: e.status,
        occurredAt: e.occurredAt,
        availableAt: e.availableAt,
        attemptCount: e.attemptCount,
        lastAttemptAt: e.lastAttemptAt,
        correlationId: e.correlationId,
        createdAt: e.createdAt,
      })),
      summary,
    };
  });

  app.get('/admin/api/diagnostics/imports/connections', async (request, reply) => {
    await requireAdmin(request);
    const query = asRecord(request.query);
    return providerAdminService.listConnections({
      provider: parseProvider(query.provider),
      expiringWithinHours: parseOptionalNumber(query.expiringWithinHours),
      refreshFailuresOnly: query.refreshFailuresOnly === true || query.refreshFailuresOnly === 'true',
      limit: parseLimit(query.limit),
    });
  });

  app.get('/admin/api/diagnostics/imports/jobs', async (request, reply) => {
    await requireAdmin(request);
    const query = asRecord(request.query);
    const result = await providerAdminService.listJobs({
      provider: parseProvider(query.provider),
      status: parseJobStatus(query.status),
      failuresOnly: query.failuresOnly === true || query.failuresOnly === 'true',
      limit: parseLimit(query.limit),
    });
    return {
      jobs: result.jobs.map((job) => mapProviderImportJobAdminView(job)),
    };
  });

  app.get('/admin/api/accounts/lookup-by-email/:email', async (request, reply) => {
    await requireAdmin(request);
    const params = asRecord(request.params);
    const account = await accountLookupService.getByEmail(readRequiredString(params.email, 'email'));
    return {
      account: {
        ...account,
        pricingTier: await accountSettingsService.getPricingTierForUser(account.accountId),
      },
    };
  });

  app.patch('/admin/api/accounts/:accountId/pricing-tier', async (request, reply) => {
    await requireAdminMutation(request);
    const params = asRecord(request.params);
    const body = asRecord(request.body);
    const pricingTier = await accountSettingsService.setPricingTierForUser(
      readRequiredString(params.accountId, 'accountId'),
      body.pricingTier,
    );
    return { pricingTier };
  });

  app.get('/admin/api/accounts/:accountId/profiles', async (request, reply) => {
    await requireAdmin(request);
    const params = asRecord(request.params);
    return {
      profiles: await recommendationDataService.listAccountProfilesForService(readRequiredString(params.accountId, 'accountId')),
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/watch-history', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const bundle = await profileInputSignalFacade.getBundle({
      accountId: params.accountId,
      profileId: params.profileId,
      include: ['history'],
      limits: { historyLimit: clampLimit(parseOptionalNumber(query.limit) ?? 25, 1, 100) },
    });
    return {
      items: bundle.history ?? [],
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/continue-watching', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const bundle = await profileInputSignalFacade.getBundle({
      accountId: params.accountId,
      profileId: params.profileId,
      include: ['continue'],
      limits: { continueLimit: clampLimit(parseOptionalNumber(query.limit) ?? 25, 1, 100) },
    });
    return {
      items: bundle.continueWatching ?? [],
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/watchlist', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const bundle = await profileInputSignalFacade.getBundle({
      accountId: params.accountId,
      profileId: params.profileId,
      include: ['watchlist'],
      limits: { watchlistLimit: clampLimit(parseOptionalNumber(query.limit) ?? 25, 1, 100) },
    });
    return {
      items: bundle.watchlist ?? [],
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/ratings', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const bundle = await profileInputSignalFacade.getBundle({
      accountId: params.accountId,
      profileId: params.profileId,
      include: ['ratings'],
      limits: { ratingsLimit: clampLimit(parseOptionalNumber(query.limit) ?? 25, 1, 100) },
    });
    return {
      items: bundle.ratings ?? [],
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/episodic-follow', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    return {
      items: await recommendationDataService.getEpisodicFollowForAccountService(
        params.accountId,
        params.profileId,
        clampLimit(parseOptionalNumber(query.limit) ?? 25, 1, 100),
      ),
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/calendar', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    return calendarService.getCalendarForAccountService(params.accountId, params.profileId);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/calendar/this-week', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    return calendarService.getThisWeekForAccountService(params.accountId, params.profileId);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/taste-profile', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    return {
      tasteProfile: await recommendationOutputService.getTasteProfileForAccountService(
        params.accountId,
        params.profileId,
        resolveRecommendationSourceKey(query.sourceKey),
      ),
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/recommendations', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const sourceKey = resolveRecommendationSourceKey(query.sourceKey);
    const algorithmVersion = resolveRecommendationAlgorithmVersion(query.algorithmVersion);
    return {
      recommendations: await recommendationOutputService.getRecommendationsForAccountService(
        params.accountId,
        params.profileId,
        sourceKey,
        algorithmVersion,
      ),
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/imports/overview', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const [connectionsResult, jobsResult, providerStates] = await Promise.all([
      providerAdminService.listConnections({ limit: 100 }),
      providerImportService.listJobs(params.accountId, params.profileId),
      loadProviderStates(providerTokenAccessService, params.accountId, params.profileId),
    ]);

    return {
      watchDataState: jobsResult.watchDataState,
      providerDiagnostics: connectionsResult.connections.filter((row) => row.profileId === params.profileId),
      jobs: jobsResult.jobs.map((job) => mapProviderImportJobView(job)),
      providers: providerStates,
    };
  });

  app.post('/admin/api/accounts/:accountId/profiles/:profileId/imports/start', async (request, reply) => {
    await requireAdminMutation(request);
    const params = parseAccountProfileParams(request.params);
    const body = asRecord(request.body);
    const provider = parseImportProvider(body.provider);
    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : 'import';
    const started = action === 'connect'
      ? await providerImportService.connectProvider(params.accountId, params.profileId, provider)
      : action === 'reconnect'
        ? await providerImportService.reconnectProvider(params.accountId, params.profileId, provider)
        : await providerImportService.importProviderNow(params.accountId, params.profileId, provider);
    reply.code(started.nextAction === 'queued' ? 202 : 201);
    return {
      nextAction: started.nextAction,
      authUrl: started.authUrl,
      watchDataState: started.watchDataState,
      providerState: started.providerState,
      job: started.job ? mapProviderImportJobView(started.job) : null,
    };
  });

  app.post('/admin/api/accounts/:accountId/profiles/:profileId/providers/:provider/refresh-token', async (request, reply) => {
    await requireAdminMutation(request);
    const params = parseProviderParams(request.params);
    const accessToken = await providerTokenAccessService.getAccessTokenForAccountProfile(
      params.accountId,
      params.profileId,
      params.provider,
      { forceRefresh: true },
    );

    return {
      provider: params.provider,
      refreshed: accessToken.refreshed,
      connection: await providerTokenAccessService.getConnectionForAccountProfile(
        params.accountId,
        params.profileId,
        params.provider,
      ),
      tokenStatus: await providerTokenAccessService.getTokenStatusForAccountProfile(
        params.accountId,
        params.profileId,
        params.provider,
      ),
    };
  });

  app.delete('/admin/api/accounts/:accountId/profiles/:profileId/providers/:provider/connection', async (request, reply) => {
    await requireAdminMutation(request);
    const params = parseProviderParams(request.params);
    return providerImportService.disconnectProviderSession(
      params.accountId,
      params.profileId,
      params.provider,
    );
  });

  app.post('/admin/api/accounts/:accountId/profiles/:profileId/recommendations/recompute', async (request, reply) => {
    await requireAdminMutation(request);
    const params = parseAccountProfileParams(request.params);
    const body = asRecord(request.body);
    const correlationId = typeof body.correlationId === 'string' && body.correlationId.trim() ? body.correlationId.trim() : crypto.randomUUID();
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

    const profileBelongsToAccount = (await recommendationDataService.listAccountProfilesForService(params.accountId))
      .some((profile) => profile.id === params.profileId);
    if (!profileBelongsToAccount) {
      throw new HttpError(404, 'Profile not found.');
    }

    await withTransaction(async (client) => {
      await recommendationOutboxService.appendRecomputeRequested(client, {
        userId: params.accountId,
        profileId: params.profileId,
        reason: 'admin_requested',
        correlationId,
      });
    });

    reply.code(202);
    return {
      ok: true,
      reason: 'admin_requested',
      accountId: params.accountId,
      profileId: params.profileId,
      requested: 1,
      enqueued: 1,
      skipped: 0,
      correlationId,
      note,
      diagnosticsUrl: `/admin/api/diagnostics/recommendations/service-outbox?correlationId=${encodeURIComponent(correlationId)}`,
    };
  });

  app.post('/admin/api/accounts/:accountId/recommendations/recompute', async (request, reply) => {
    await requireAdminMutation(request);
    const params = asRecord(request.params);
    const accountId = readRequiredString(params.accountId, 'accountId');
    const body = asRecord(request.body);
    const profileIds = Array.isArray(body.profileIds) ? body.profileIds : [];
    const correlationId = typeof body.correlationId === 'string' && body.correlationId.trim() ? body.correlationId.trim() : crypto.randomUUID();
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

    if (profileIds.length === 0) {
      throw new HttpError(400, 'profileIds array is required and must not be empty.');
    }
    if (profileIds.length > 50) {
      throw new HttpError(400, 'Maximum 50 profiles allowed per request.');
    }

    const validProfileIds = profileIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => String(id).trim());
    if (validProfileIds.length === 0) {
      throw new HttpError(400, 'No valid profile IDs provided.');
    }

    const profiles = await recommendationDataService.listAccountProfilesForService(accountId);
    const accountProfileIds = new Set(profiles.map((p) => p.id));
    const validatedProfileIds = validProfileIds.filter((id) => accountProfileIds.has(id));
    const skipped = validProfileIds.length - validatedProfileIds.length;

    let enqueued = 0;
    await withTransaction(async (client) => {
      for (const profileId of validatedProfileIds) {
        await recommendationOutboxService.appendRecomputeRequested(client, {
          userId: accountId,
          profileId,
          reason: 'admin_requested',
          correlationId,
        });
        enqueued++;
      }
    });

    reply.code(202);
    return {
      ok: true,
      reason: 'admin_requested',
      accountId,
      profileIds: validatedProfileIds,
      requested: validProfileIds.length,
      enqueued,
      skipped,
      correlationId,
      note,
      diagnosticsUrl: `/admin/api/diagnostics/recommendations/service-outbox?correlationId=${encodeURIComponent(correlationId)}`,
    };
  });

  app.get('/admin/api/ai/config', async (request, reply) => {
    await requireAdmin(request);
    const serverProvider = getServerAiProvider();
    const byokProvider = getByokOpenRouterProvider();
    const serverAvailable = !!env.aiServerApiKey;

    const serverModels: Array<{ tier: string; feature: string; model: string }> = [];
    if (serverAvailable) {
      for (const [tier, features] of Object.entries(serverProvider.models)) {
        for (const [feature, model] of Object.entries(features)) {
          serverModels.push({ tier, feature, model });
        }
      }
    }

    const byokModels: Array<{ feature: string; model: string }> = [];
    for (const [feature, model] of Object.entries(byokProvider.models)) {
      byokModels.push({ feature, model });
    }

    return {
      server: {
        available: serverAvailable,
        label: serverProvider.label,
        models: serverModels,
      },
      byok: {
        available: true,
        label: byokProvider.label,
        models: byokModels,
      },
    };
  });

  app.post('/admin/api/ai/test', async (request, reply) => {
    await requireAdminMutation(request);
    const body = asRecord(request.body);
    const prompt = readRequiredString(body.prompt, 'prompt');
    const targets = Array.isArray(body.targets) ? body.targets : [];

    if (targets.length === 0) {
      throw new HttpError(400, 'At least one target is required.');
    }
    if (targets.length > 20) {
      throw new HttpError(400, 'Maximum 20 targets allowed per request.');
    }

    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const results: Array<{
      mode: string;
      tier?: string;
      feature?: string;
      model: string;
      status: string;
      durationMs: number;
      result?: unknown;
      error?: string;
      providerError?: AiProviderFailureDetails;
      logs?: string[];
    }> = [];

    let byokApiKey: string | null = null;
    const hasByokTarget = targets.some((t) => {
      const targetRecord = asRecord(t);
      return targetRecord.mode === 'byok';
    });
    if (hasByokTarget) {
      byokApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (!byokApiKey) {
        throw new HttpError(400, 'apiKey is required for BYOK targets.');
      }
    }

    const serverProvider = getServerAiProvider();
    const byokProvider = getByokOpenRouterProvider();

    for (const target of targets) {
      const targetRecord = asRecord(target);
      const mode = readRequiredString(targetRecord.mode, 'target.mode');
      const model = readRequiredString(targetRecord.model, 'target.model');
      const tier = typeof targetRecord.tier === 'string' ? targetRecord.tier.trim() : undefined;
      const feature = typeof targetRecord.feature === 'string' ? targetRecord.feature.trim() : undefined;

      const startMs = Date.now();
      const logs: string[] = [];

      try {
        let resolvedProvider: AiResolvedProviderConfig;
        let apiKey: string;

        if (mode === 'server') {
          if (!env.aiServerApiKey) {
            throw new Error('Server AI credentials are not configured.');
          }
          resolvedProvider = {
            id: serverProvider.id,
            label: serverProvider.label,
            endpointUrl: serverProvider.endpointUrl,
            httpReferer: env.appPublicUrl,
            title: env.appDisplayName,
          };
          apiKey = env.aiServerApiKey;
          logs.push(`Using server AI: ${serverProvider.label}`);
          if (tier) logs.push(`Tier: ${tier}`);
          if (feature) logs.push(`Feature: ${feature}`);
        } else if (mode === 'byok') {
          if (!byokApiKey) {
            throw new Error('BYOK API key is required.');
          }
          resolvedProvider = {
            id: byokProvider.id,
            label: byokProvider.label,
            endpointUrl: byokProvider.endpointUrl,
            httpReferer: env.appPublicUrl,
            title: env.appDisplayName,
          };
          apiKey = byokApiKey;
          logs.push(`Using BYOK: ${byokProvider.label}`);
          if (feature) logs.push(`Feature: ${feature}`);
        } else {
          throw new Error(`Invalid mode: ${mode}. Must be "server" or "byok".`);
        }

        logs.push(`Model: ${model}`);
        const result = await aiClient.generateJson({
          provider: resolvedProvider,
          apiKey,
          model,
          userPrompt: prompt,
        });

        results.push({
          mode,
          tier,
          feature,
          model,
          status: 'success',
          durationMs: Date.now() - startMs,
          result,
          logs,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const providerErrorDetails = error instanceof HttpError
          ? sanitizeProviderFailureDetails(error.details)
          : undefined;
        const sanitizedError = providerErrorDetails
          ? `Provider rejected this model: ${sanitizeAiErrorText(errorMessage)}`
          : sanitizeAiErrorText(errorMessage);
        if (providerErrorDetails) {
          logs.push(providerErrorDetails.providerStatus === undefined
            ? 'Provider error returned by upstream AI provider.'
            : `Provider error returned by upstream AI provider with status ${providerErrorDetails.providerStatus}.`);
        }

        results.push({
          mode,
          tier,
          feature,
          model,
          status: 'error',
          durationMs: Date.now() - startMs,
          error: sanitizedError,
          providerError: providerErrorDetails,
          logs,
        });
      }
    }

    const completedAt = new Date().toISOString();
    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    return {
      runId,
      startedAt,
      completedAt,
      summary: {
        total: results.length,
        success: successCount,
        error: errorCount,
      },
      results,
    };
  });
}

async function loadProviderStates(
  providerTokenAccessService: ProviderTokenAccessService,
  accountId: string,
  profileId: string,
): Promise<Array<{
  provider: ProviderImportProvider;
  connected: boolean;
  connection: Awaited<ReturnType<ProviderTokenAccessService['getConnectionForAccountProfile']>> | null;
  tokenStatus: Awaited<ReturnType<ProviderTokenAccessService['getTokenStatusForAccountProfile']>> | null;
  error: string | null;
}>> {
  const providers: ProviderImportProvider[] = ['trakt', 'simkl'];
  return Promise.all(providers.map(async (provider) => {
    try {
      const [connection, tokenStatus] = await Promise.all([
        providerTokenAccessService.getConnectionForAccountProfile(accountId, profileId, provider),
        providerTokenAccessService.getTokenStatusForAccountProfile(accountId, profileId, provider),
      ]);
      return {
        provider,
        connected: true,
        connection,
        tokenStatus,
        error: null,
      };
    } catch (error) {
      if (error instanceof HttpError && (error.statusCode === 404 || error.statusCode === 409 || error.statusCode === 503)) {
        return {
          provider,
          connected: false,
          connection: null,
          tokenStatus: null,
          error: error.message,
        };
      }
      throw error;
    }
  }));
}

function parseAccountProfileParams(value: unknown): { accountId: string; profileId: string } {
  const params = asRecord(value);
  return {
    accountId: readRequiredString(params.accountId, 'accountId'),
    profileId: readRequiredString(params.profileId, 'profileId'),
  };
}

function parseProviderParams(value: unknown): { accountId: string; profileId: string; provider: ProviderImportProvider } {
  const params = parseAccountProfileParams(value);
  const raw = asRecord(value).provider;
  if (!isProviderImportProvider(raw)) {
    throw new HttpError(400, 'Invalid provider.');
  }
  return {
    ...params,
    provider: raw,
  };
}

function parseProvider(value: unknown): ProviderImportProvider | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (!isProviderImportProvider(value)) {
    throw new HttpError(400, 'Invalid provider filter.');
  }
  return value;
}

function parseJobStatus(value: unknown): ProviderImportJobStatus | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !JOB_STATUSES.has(value as ProviderImportJobStatus)) {
    throw new HttpError(400, 'Invalid import job status filter.');
  }
  return value as ProviderImportJobStatus;
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseLimit(value: unknown): number {
  return clampLimit(parseOptionalNumber(value) ?? 100, 1, 250);
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function parseBulkJobLimit(value: unknown): number {
  return clampLimit(parseOptionalNumber(value) ?? 50, 1, 100);
}

function parseBulkJobScopeFilter(value: unknown): AdminBulkJobScope['type'] | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const scope = typeof value === 'string' ? value.trim() : null;
  if (scope === 'explicit_targets' || scope === 'all_users' || scope === 'tier') {
    return scope;
  }
  throw new HttpError(400, 'Invalid bulk job scope filter.');
}

function ensureRecomputeJobsEnabled(): void {
  if (!env.adminRecommendationRecomputeJobsEnabled) {
    throw new HttpError(403, 'Recommendation recompute jobs are disabled.');
  }
}

function parseBulkJobInput(body: Record<string, unknown>): { scope: AdminBulkJobScope; targets: AdminBulkJobTargetInput[]; reason: string | null; idempotencyKey?: string | null; correlationId?: string | null } {
  const scopeRecord = asRecord(body.scope);
  const scopeType = typeof scopeRecord.type === 'string' ? scopeRecord.type : null;
  const scope = scopeType === 'explicit_targets'
    ? { type: 'explicit_targets' } as const
    : scopeType === 'all_users'
      ? { type: 'all_users' } as const
      : scopeType === 'tier' && (scopeRecord.tier === 'free' || scopeRecord.tier === 'pro' || scopeRecord.tier === 'ultra')
        ? { type: 'tier', tier: scopeRecord.tier } as const
        : null;
  if (!scope) {
    throw new HttpError(400, 'Invalid bulk job scope.');
  }
  const rawTargets = Array.isArray(body.targets) ? body.targets : [];
  const targets = rawTargets
    .map((target) => asRecord(target))
    .filter((target) => typeof target.accountId === 'string' && typeof target.profileId === 'string')
    .map((target) => ({ accountId: String(target.accountId), profileId: String(target.profileId) }));
  return {
    scope,
    targets,
    reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
    idempotencyKey: typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey.trim() : null,
    correlationId: typeof body.correlationId === 'string' && body.correlationId.trim() ? body.correlationId.trim() : null,
  };
}

function parseBulkJobStatus(value: unknown): AdminBulkJobStatus | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const status = typeof value === 'string' ? value.trim() : null;
  if (status === 'queued' || status === 'enumerating' || status === 'fanout' || status === 'paused' || status === 'canceling' || status === 'canceled' || status === 'completed' || status === 'failed') {
    return status;
  }
  throw new HttpError(400, 'Invalid bulk job status filter.');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sanitizeAiErrorText(value: string): string {
  return value.replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/Authorization:\s*[^\s]+/gi, 'Authorization: [REDACTED]');
}

function sanitizeProviderFailureDetails(value: unknown): AiProviderFailureDetails | undefined {
  const details = asRecord(value);
  const provider = typeof details.provider === 'string' && details.provider.trim()
    ? details.provider.trim()
    : undefined;
  if (!provider) {
    return undefined;
  }

  return {
    provider,
    providerStatus: typeof details.providerStatus === 'number' ? details.providerStatus : undefined,
    responseBody: typeof details.responseBody === 'string' ? sanitizeAiErrorText(details.responseBody).slice(0, 500) : undefined,
    providerErrorCode: typeof details.providerErrorCode === 'string' ? details.providerErrorCode : undefined,
    providerErrorParam: typeof details.providerErrorParam === 'string' ? details.providerErrorParam : undefined,
    retryAfterSeconds: typeof details.retryAfterSeconds === 'number' ? details.retryAfterSeconds : undefined,
    failureKind: isAiProviderFailureKind(details.failureKind) ? details.failureKind : undefined,
    errorMessage: typeof details.errorMessage === 'string' ? sanitizeAiErrorText(details.errorMessage) : undefined,
  };
}

function isAiProviderFailureKind(value: unknown): value is AiProviderFailureDetails['failureKind'] {
  return value === 'network' || value === 'provider_response' || value === 'invalid_response';
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
}
