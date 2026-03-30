import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { ProviderAdminService } from '../../modules/integrations/provider-admin.service.js';
import { mapProviderImportJobAdminView } from '../../modules/integrations/provider-import.views.js';
import {
  isProviderImportProvider,
  type ProviderImportConnectionStatus,
  type ProviderImportJobStatus,
  type ProviderImportProvider,
} from '../../modules/integrations/provider-import.types.js';

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

export async function registerInternalAdminImportRoutes(app: FastifyInstance): Promise<void> {
  const adminService = new ProviderAdminService();

  app.get('/internal/v1/admin/imports/connections', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['admin:diagnostics:read']);
    const query = asRecord(request.query);
    return adminService.listConnections({
      provider: parseProvider(query.provider),
      status: parseConnectionStatus(query.status),
      expiringWithinHours: parseOptionalNumber(query.expiringWithinHours),
      refreshFailuresOnly: query.refreshFailuresOnly === true || query.refreshFailuresOnly === 'true',
      limit: parseLimit(query.limit),
    });
  });

  app.get('/internal/v1/admin/imports/jobs', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['admin:diagnostics:read']);
    const query = asRecord(request.query);
    const result = await adminService.listJobs({
      provider: parseProvider(query.provider),
      status: parseJobStatus(query.status),
      failuresOnly: query.failuresOnly === true || query.failuresOnly === 'true',
      limit: parseLimit(query.limit),
    });
    return {
      jobs: result.jobs.map((job) => mapProviderImportJobAdminView(job)),
    };
  });
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
  const parsed = parseOptionalNumber(value);
  return Math.min(Math.max(Math.trunc(parsed ?? 100), 1), 250);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
