import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { RecommendationAdminService } from '../../modules/recommendations/recommendation-admin.service.js';
import {
  resolveRecommendationAlgorithmVersion,
  resolveRecommendationSourceKey,
} from '../../modules/recommendations/recommendation-config.js';
import { ProviderAdminService } from '../../modules/integrations/provider-admin.service.js';
import { ProviderImportService, parseImportProvider } from '../../modules/integrations/provider-import.service.js';
import { ProviderTokenAccessService } from '../../modules/integrations/provider-token-access.service.js';
import { PersonalMediaService } from '../../modules/watch/personal-media.service.js';
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

const JOB_STATUSES = new Set<ProviderImportJobStatus>([
  'oauth_pending',
  'queued',
  'running',
  'succeeded',
  'succeeded_with_warnings',
  'failed',
  'cancelled',
]);

export async function registerAdminApiRoutes(app: FastifyInstance): Promise<void> {
  const recommendationAdminService = new RecommendationAdminService();
  const providerAdminService = new ProviderAdminService();
  const providerImportService = new ProviderImportService();
  const providerTokenAccessService = new ProviderTokenAccessService();
  const accountLookupService = new AccountLookupService();
  const recommendationDataService = new RecommendationDataService();
  const recommendationOutputService = new RecommendationOutputService();
  const personalMediaService = new PersonalMediaService();
  const calendarService = new CalendarService();

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

  app.get('/admin/api/diagnostics/recommendations/outbox', async (request, reply) => {
    await requireAdmin(request);
    const query = asRecord(request.query);
    return recommendationAdminService.getOutbox(parseLimit(query.limit));
  });


  app.post('/admin/api/recommendation-batches/dry-run', async (request, reply) => {
    await requireAdminMutation(request);
    return proxyRecommendationEngineAdmin('/admin/api/recommendation-batches/dry-run', 'POST', request.body);
  });

  app.post('/admin/api/recommendation-batches/:dryRunId/confirm', async (request, reply) => {
    await requireAdminMutation(request);
    const params = asRecord(request.params);
    const dryRunId = readRequiredString(params.dryRunId, 'dryRunId');
    reply.code(202);
    return proxyRecommendationEngineAdmin(`/admin/api/recommendation-batches/${encodeURIComponent(dryRunId)}/confirm`, 'POST', request.body);
  });

  app.get('/admin/api/recommendation-batches', async (request, reply) => {
    await requireAdmin(request);
    const query = asRecord(request.query);
    const limit = parseLimit(query.limit);
    return proxyRecommendationEngineAdmin(`/admin/api/recommendation-batches?limit=${encodeURIComponent(String(limit))}`, 'GET');
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
    return {
      account: await accountLookupService.getByEmail(readRequiredString(params.email, 'email')),
    };
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
    return {
      items: await recommendationDataService.getWatchHistoryForAccountService(
        params.accountId,
        params.profileId,
        clampLimit(parseOptionalNumber(query.limit) ?? 25, 1, 100),
      ),
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/continue-watching', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const page = await personalMediaService.listContinueWatchingPage(params.accountId, params.profileId, {
      limit: clampLimit(parseOptionalNumber(query.limit) ?? 25, 1, 100),
    });
    return {
      items: page.items,
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/watchlist', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    return {
      items: await recommendationDataService.getWatchlistForAccountService(
        params.accountId,
        params.profileId,
        clampLimit(parseOptionalNumber(query.limit) ?? 25, 1, 100),
      ),
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/ratings', async (request, reply) => {
    await requireAdmin(request);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    return {
      items: await recommendationDataService.getRatingsForAccountService(
        params.accountId,
        params.profileId,
        clampLimit(parseOptionalNumber(query.limit) ?? 25, 1, 100),
      ),
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


async function proxyRecommendationEngineAdmin(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const baseUrl = process.env.RECOMMENDATION_ENGINE_ADMIN_URL?.trim()?.replace(/\/+$/, '');
  const token = process.env.RECOMMENDATION_ENGINE_ADMIN_TOKEN?.trim();
  if (!baseUrl) {
    throw new HttpError(503, 'RECOMMENDATION_ENGINE_ADMIN_URL is not configured');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'message' in payload
      ? String((payload as { message?: unknown }).message)
      : `Recommendation engine admin request failed: ${response.status}`;
    throw new HttpError(response.status, message);
  }
  return payload;
}

function parseLimit(value: unknown): number {
  return clampLimit(parseOptionalNumber(value) ?? 100, 1, 250);
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
}
