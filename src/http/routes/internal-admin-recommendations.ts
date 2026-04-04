import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { RecommendationAdminService } from '../../modules/recommendations/recommendation-admin.service.js';

export async function registerInternalAdminRecommendationRoutes(app: FastifyInstance): Promise<void> {
  const adminService = new RecommendationAdminService();

  app.get('/internal/v1/admin/recommendations/outbox', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['admin:diagnostics:read']);
    const query = asRecord(request.query);
    return adminService.getOutbox(parseLimit(query.limit));
  });

  app.get('/internal/v1/admin/recommendations/generation-jobs', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['admin:diagnostics:read']);
    const query = asRecord(request.query);
    return adminService.getGenerationJobs(parseLimit(query.limit));
  });

  app.get('/internal/v1/admin/recommendations/generation-jobs/:jobId', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['admin:diagnostics:read']);
    const params = asRecord(request.params);
    return adminService.getGenerationJob(readRequiredString(params.jobId, 'jobId'));
  });
}

function parseLimit(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampLimit(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clampLimit(parsed);
    }
  }

  return 100;
}

function clampLimit(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 1), 250);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new HttpError(400, `Missing ${field}`);
}
