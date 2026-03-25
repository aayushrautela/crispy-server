import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { WorkerControlClient, type WorkerControlJobTarget } from '../../modules/admin/worker-control-client.js';
import { RecommendationAdminService } from '../../modules/recommendations/recommendation-admin.service.js';
import { ProviderAdminService } from '../../modules/imports/provider-admin.service.js';
import type {
  ProviderImportConnectionStatus,
  ProviderImportJobStatus,
  ProviderImportProvider,
} from '../../modules/imports/provider-import.types.js';
import { isProviderImportProvider } from '../../modules/imports/provider-import.types.js';
import { AccountLookupService } from '../../modules/users/account-lookup.service.js';
import { RecommendationDataService } from '../../modules/recommendations/recommendation-data.service.js';
import { RecommendationOutputService } from '../../modules/recommendations/recommendation-output.service.js';
import { mapProviderImportJobAdminView } from '../../modules/imports/provider-import.views.js';

const CONNECTION_STATUSES = new Set<ProviderImportConnectionStatus>(['pending', 'connected', 'expired', 'revoked']);
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
  const workerControlClient = new WorkerControlClient();
  const recommendationAdminService = new RecommendationAdminService();
  const providerAdminService = new ProviderAdminService();
  const accountLookupService = new AccountLookupService();
  const recommendationDataService = new RecommendationDataService();
  const recommendationOutputService = new RecommendationOutputService();

  async function requireAdmin(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): Promise<void> {
    await app.requireAdminUi(request, reply);
  }

  app.get('/admin/api/worker/control-status', async (request, reply) => {
    await requireAdmin(request, reply);
    return {
      workerControl: {
        configured: workerControlClient.isConfigured(),
      },
    };
  });

  app.get('/admin/api/worker/jobs/status', async (request, reply) => {
    await requireAdmin(request, reply);
    return workerControlClient.getJobStatus();
  });

  app.post('/admin/api/worker/jobs/trigger', async (request, reply) => {
    await requireAdmin(request, reply);
    return workerControlClient.triggerJob(parseTriggerInput(request.body));
  });

  app.post('/admin/api/worker/jobs/:jobId/cancel', async (request, reply) => {
    await requireAdmin(request, reply);
    const params = asRecord(request.params);
    return workerControlClient.cancelJob(readRequiredString(params.jobId, 'jobId'));
  });

  app.delete('/admin/api/worker/jobs/:jobId', async (request, reply) => {
    await requireAdmin(request, reply);
    const params = asRecord(request.params);
    return workerControlClient.deleteJob(readRequiredString(params.jobId, 'jobId'));
  });

  app.get('/admin/api/diagnostics/recommendations/work-state', async (request, reply) => {
    await requireAdmin(request, reply);
    const query = asRecord(request.query);
    return recommendationAdminService.getWorkState(parseLimit(query.limit));
  });

  app.get('/admin/api/diagnostics/recommendations/outbox', async (request, reply) => {
    await requireAdmin(request, reply);
    const query = asRecord(request.query);
    return recommendationAdminService.getOutbox(parseLimit(query.limit));
  });

  app.get('/admin/api/diagnostics/recommendations/consumers', async (request, reply) => {
    await requireAdmin(request, reply);
    const query = asRecord(request.query);
    return recommendationAdminService.listConsumers(parseLimit(query.limit));
  });

  app.get('/admin/api/diagnostics/imports/connections', async (request, reply) => {
    await requireAdmin(request, reply);
    const query = asRecord(request.query);
    return providerAdminService.listConnections({
      provider: parseProvider(query.provider),
      status: parseConnectionStatus(query.status),
      expiringWithinHours: parseOptionalNumber(query.expiringWithinHours),
      refreshFailuresOnly: query.refreshFailuresOnly === true || query.refreshFailuresOnly === 'true',
      limit: parseLimit(query.limit),
    });
  });

  app.get('/admin/api/diagnostics/imports/jobs', async (request, reply) => {
    await requireAdmin(request, reply);
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
    await requireAdmin(request, reply);
    const params = asRecord(request.params);
    return {
      account: await accountLookupService.getByEmail(readRequiredString(params.email, 'email')),
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles', async (request, reply) => {
    await requireAdmin(request, reply);
    const params = asRecord(request.params);
    return {
      profiles: await recommendationDataService.listAccountProfilesForService(readRequiredString(params.accountId, 'accountId')),
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/watch-history', async (request, reply) => {
    await requireAdmin(request, reply);
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

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/taste-profile', async (request, reply) => {
    await requireAdmin(request, reply);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    return {
      tasteProfile: await recommendationOutputService.getTasteProfileForAccountService(
        params.accountId,
        params.profileId,
        typeof query.sourceKey === 'string' && query.sourceKey.trim() ? query.sourceKey.trim() : 'default',
      ),
    };
  });

  app.get('/admin/api/accounts/:accountId/profiles/:profileId/recommendations', async (request, reply) => {
    await requireAdmin(request, reply);
    const params = parseAccountProfileParams(request.params);
    const query = asRecord(request.query);
    const sourceKey = typeof query.sourceKey === 'string' && query.sourceKey.trim() ? query.sourceKey.trim() : 'default';
    const algorithmVersion = typeof query.algorithmVersion === 'string' && query.algorithmVersion.trim()
      ? query.algorithmVersion.trim()
      : 'default';
    return {
      recommendations: await recommendationOutputService.getRecommendationsForAccountService(
        params.accountId,
        params.profileId,
        sourceKey,
        algorithmVersion,
      ),
    };
  });
}

function parseTriggerInput(body: unknown): { target: WorkerControlJobTarget; options?: Record<string, unknown> } {
  const value = asRecord(body);
  const target = readRequiredString(value.target, 'target');
  if (target !== 'recommendations_daily' && target !== 'provider_token_maintenance') {
    throw new HttpError(400, 'Invalid worker target.');
  }

  const options = value.options;
  return {
    target,
    options: typeof options === 'object' && options !== null && !Array.isArray(options)
      ? options as Record<string, unknown>
      : undefined,
  };
}

function parseAccountProfileParams(value: unknown): { accountId: string; profileId: string } {
  const params = asRecord(value);
  return {
    accountId: readRequiredString(params.accountId, 'accountId'),
    profileId: readRequiredString(params.profileId, 'profileId'),
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

function parseConnectionStatus(value: unknown): ProviderImportConnectionStatus | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !CONNECTION_STATUSES.has(value as ProviderImportConnectionStatus)) {
    throw new HttpError(400, 'Invalid connection status filter.');
  }
  return value as ProviderImportConnectionStatus;
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
