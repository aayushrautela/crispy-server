import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { getServerAiProvider } from '../../config/app-config.js';
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
import { mapProviderImportJobAdminView, mapProviderImportJobView } from '../../modules/integrations/provider-import.views.js';
import { CalendarService } from '../../modules/calendar/calendar.service.js';
import { AccountSettingsService } from '../../modules/users/account-settings.service.js';
import { AdminWatchReadService } from '../../modules/integrations/admin-watch-read.service.js';
import { EpisodicFollowService } from '../../modules/watch/episodic-follow.service.js';
import { WatchMetadataEnrichmentService } from '../../modules/watch/watch-metadata-enrichment.service.js';
import { withDbClient, withTransaction, db } from '../../lib/db.js';
import { success, mutation } from '../response.js';
import { registerHomeAdminRoutes } from './home-admin.routes.js';

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
  const adminWatchReadService = new AdminWatchReadService();
  const episodicFollowService = new EpisodicFollowService();
  const watchMetadataEnrichmentService = new WatchMetadataEnrichmentService();


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

  app.get('/admin/api/recommendations/runs', async (request, reply) => {
    await requireAdmin(request);
    const query = asRecord(request.query);
    const limit = parseLimit(query.limit);
    const status = typeof query.status === 'string' && query.status.trim() ? query.status.trim() : null;
    let sql = `SELECT run_id, app_id, purpose, run_type, status, model_version, algorithm, progress, error, created_at, updated_at, completed_at FROM recommendation.runs ORDER BY created_at DESC LIMIT $1`;
    const params: unknown[] = [limit];
    if (status) {
      sql = `SELECT run_id, app_id, purpose, run_type, status, model_version, algorithm, progress, error, created_at, updated_at, completed_at FROM recommendation.runs WHERE status = $2 ORDER BY created_at DESC LIMIT $1`;
      params.push(status);
    }
    const { rows } = await db.query(sql, params);
    return success({ runs: rows ?? [] }, request);
  });

  app.get('/admin/api/recommendations/runs/:runId', async (request, reply) => {
    await requireAdmin(request);
    const params = asRecord(request.params);
    const runId = readRequiredString(params.runId, 'runId');
    const { rows } = await db.query(`SELECT * FROM recommendation.runs WHERE run_id = $1::uuid`, [runId]);
    const run = rows[0] ?? null;
    if (!run) {
      throw new HttpError(404, 'Recommendation run not found.');
    }
    return success({ run }, request);
  });

  app.get('/admin/api/recommendations/runs/:runId/batches', async (request, reply) => {
    await requireAdmin(request);
    const params = asRecord(request.params);
    const query = asRecord(request.query);
    const { rows } = await db.query(
      `SELECT * FROM recommendation.batches WHERE run_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
      [readRequiredString(params.runId, 'runId'), parseLimit(query.limit)],
    );
    return success({ batches: rows ?? [] }, request);
  });

  app.get('/admin/api/recommendations/runs/:runId/logs', async (request, reply) => {
    await requireAdmin(request);
    const params = asRecord(request.params);
    const query = asRecord(request.query);
    const { rows } = await db.query(
      `SELECT id, run_id, batch_id, level, code, message, safe_context, created_at FROM recommendation.run_logs WHERE run_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
      [readRequiredString(params.runId, 'runId'), parseLimit(query.limit)],
    );
    return success({ logs: rows ?? [] }, request);
  });

  app.get('/admin/api/diagnostics/imports/connections', async (request, reply) => {
    await requireAdmin(request);
    const query = asRecord(request.query);
    return success(await providerAdminService.listConnections({
      provider: parseProvider(query.provider),
      expiringWithinHours: parseOptionalNumber(query.expiringWithinHours),
      refreshFailuresOnly: query.refreshFailuresOnly === true || query.refreshFailuresOnly === 'true',
      limit: parseLimit(query.limit),
    }), request);
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
    return success({
      jobs: result.jobs.map((job) => mapProviderImportJobAdminView(job)),
    }, request);
  });

  app.get('/admin/api/accounts/lookup-by-email/:email', async (request, reply) => {
    await requireAdmin(request);
    const params = asRecord(request.params);
    const account = await accountLookupService.getByEmail(readRequiredString(params.email, 'email'));
    return success({
      account: {
        ...account,
        pricingTier: await accountSettingsService.getPricingTierForUser(account.accountId),
      },
    }, request);
  });

  app.patch('/admin/api/accounts/:accountId/pricing-tier', async (request, reply) => {
    await requireAdminMutation(request);
    const params = asRecord(request.params);
    const body = asRecord(request.body);
    const pricingTier = await accountSettingsService.setPricingTierForUser(
      readRequiredString(params.accountId, 'accountId'),
      body.pricingTier,
    );
    return success({ pricingTier }, request);
  });

  app.get('/admin/api/accounts/:accountId/profiles', async (request, reply) => {
    await requireAdmin(request);
    const params = asRecord(request.params);
    return success({
      profiles: await recommendationDataService.listAccountProfilesForService(readRequiredString(params.accountId, 'accountId')),
    }, request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/watch-history', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const generatedAt = new Date().toISOString();
    const page = await withDbClient(async (client) => {
      const result = await adminWatchReadService.listHistoryPage(client, {
        ...params,
        limit: parseLimit(query.limit),
        cursor: parseNullableString(query.cursor),
      });
      return {
        ...result,
        items: await watchMetadataEnrichmentService.enrichRegularMediaItems(client, result.items),
      };
    });
    return success({
      profileId: params.profileId,
      kind: 'history' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: page.items,
      pageInfo: page.pageInfo,
    }, request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/continue-watching', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const generatedAt = new Date().toISOString();
    const page = await withDbClient(async (client) => {
      const result = await adminWatchReadService.listContinueWatchingPage(client, {
        ...params,
        limit: parseLimit(query.limit),
        cursor: parseNullableString(query.cursor),
      });
      return {
        ...result,
        items: await watchMetadataEnrichmentService.enrichContinueWatchingItems(client, result.items),
      };
    });
    return success({
      profileId: params.profileId,
      kind: 'continue-watching' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: page.items,
      pageInfo: page.pageInfo,
    }, request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/watchlist', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const generatedAt = new Date().toISOString();
    const page = await withDbClient(async (client) => {
      const result = await adminWatchReadService.listWatchlistPage(client, {
        ...params,
        limit: parseLimit(query.limit),
        cursor: parseNullableString(query.cursor),
      });
      return {
        ...result,
        items: await watchMetadataEnrichmentService.enrichRegularMediaItems(client, result.items),
      };
    });
    return success({
      profileId: params.profileId,
      kind: 'watchlist' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: page.items,
      pageInfo: page.pageInfo,
    }, request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/ratings', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const generatedAt = new Date().toISOString();
    const page = await withDbClient(async (client) => {
      const result = await adminWatchReadService.listRatingsPage(client, {
        ...params,
        limit: parseLimit(query.limit),
        cursor: parseNullableString(query.cursor),
      });
      return {
        ...result,
        items: await watchMetadataEnrichmentService.enrichRegularMediaItems(client, result.items),
      };
    });
    return success({
      profileId: params.profileId,
      kind: 'ratings' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: page.items,
      pageInfo: page.pageInfo,
    }, request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/episodic-follow', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const generatedAt = new Date().toISOString();
    const items = await withDbClient(async (client) => {
      await adminWatchReadService.assertProfileAccess(client, params);
      return episodicFollowService.listForProfile(client, params.profileId, parseLimit(query.limit));
    });
    return success({
      profileId: params.profileId,
      kind: 'episodic-follow' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items,
      pageInfo: { hasMore: false, nextCursor: null },
    }, request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/calendar', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    return success(await calendarService.getCalendarForAccountService(params.accountId, params.profileId), request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/calendar/this-week', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    return success(await calendarService.getThisWeekForAccountService(params.accountId, params.profileId), request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/taste-profile', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    return success({
      tasteProfile: await recommendationOutputService.getTasteProfileForAccountService(
        params.accountId,
        params.profileId,
        resolveRecommendationSourceKey(query.sourceKey),
      ),
    }, request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/recommendations', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const sourceKey = resolveRecommendationSourceKey(query.sourceKey);
    const algorithmVersion = resolveRecommendationAlgorithmVersion(query.algorithmVersion);
    return success({
      recommendations: await recommendationOutputService.getRecommendationsForAccountService(
        params.accountId,
        params.profileId,
        sourceKey,
        algorithmVersion,
      ),
    }, request);
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/imports/overview', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const [connectionsResult, jobsResult, providerStates] = await Promise.all([
      providerAdminService.listConnections({ limit: 100 }),
      providerImportService.listJobs(params.accountId, params.profileId),
      loadProviderStates(providerTokenAccessService, params.accountId, params.profileId),
    ]);

    return success({
      watchDataState: jobsResult.watchDataState,
      providerDiagnostics: connectionsResult.connections.filter((row) => row.profileId === params.profileId),
      jobs: jobsResult.jobs.map((job) => mapProviderImportJobView(job)),
      providers: providerStates,
    }, request);
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
    return mutation({
      nextAction: started.nextAction,
      authUrl: started.authUrl,
      watchDataState: started.watchDataState,
      providerState: started.providerState,
      job: started.job ? mapProviderImportJobView(started.job) : null,
    }, request);
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

    return success({
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
    }, request);
  });

  app.delete('/admin/api/accounts/:accountId/profiles/:profileId/providers/:provider/connection', async (request, reply) => {
    await requireAdminMutation(request);
    const params = parseProviderParams(request.params);
    return success(await providerImportService.disconnectProviderSession(
      params.accountId,
      params.profileId,
      params.provider,
    ), request);
  });

  app.post('/admin/api/accounts/:accountId/profiles/:profileId/notify-recompute', async (request, reply) => {
    await requireAdminMutation(request);
    const params = parseAccountProfileParams(request.params);
    const profileBelongsToAccount = (await recommendationDataService.listAccountProfilesForService(params.accountId))
      .some((profile) => profile.id === params.profileId);
    if (!profileBelongsToAccount) {
      throw new HttpError(404, 'Profile not found.');
    }
    app.recommenderNotifier?.notifyRecompute({
      accountId: params.accountId,
      profileId: params.profileId,
      reason: 'admin_requested',
    });
    reply.code(202);
    return mutation({ ok: true, accountId: params.accountId, profileId: params.profileId }, request);
  });

  app.post('/admin/api/accounts/:accountId/recommendations/notify-recompute', async (request, reply) => {
    await requireAdminMutation(request);
    const params = asRecord(request.params);
    const accountId = readRequiredString(params.accountId, 'accountId');
    const body = asRecord(request.body);
    const profileIds = Array.isArray(body.profileIds) ? body.profileIds : [];
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
    for (const profileId of validatedProfileIds) {
      app.recommenderNotifier?.notifyRecompute({ accountId, profileId, reason: 'admin_requested' });
    }
    reply.code(202);
    return mutation({
      ok: true,
      accountId,
      profileIds: validatedProfileIds,
      enqueued: validatedProfileIds.length,
      skipped: validProfileIds.length - validatedProfileIds.length,
    }, request);
  });

  app.get('/admin/api/ai/config', async (request, reply) => {
    await requireAdmin(request);
    const serverProvider = getServerAiProvider();
    const serverAvailable = !!env.aiServerApiKey;

    const serverModels: Array<{ tier: string; feature: string; model: string }> = [];
    if (serverAvailable) {
      for (const [tier, features] of Object.entries(serverProvider.models)) {
        for (const [feature, model] of Object.entries(features)) {
          serverModels.push({ tier, feature, model });
        }
      }
    }

    return success({
      server: {
        available: serverAvailable,
        label: serverProvider.label,
        models: serverModels,
      },
    }, request);
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

    const serverProvider = getServerAiProvider();

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
        } else {
          throw new Error(`Invalid mode: ${mode}. Must be "server".`);
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

    return mutation({
      runId,
      startedAt,
      completedAt,
      summary: {
        total: results.length,
        success: successCount,
        error: errorCount,
      },
      results,
    }, request);
  });

  await registerHomeAdminRoutes(app);
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

function parseNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
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
