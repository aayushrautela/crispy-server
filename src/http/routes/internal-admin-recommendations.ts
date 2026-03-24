import type { FastifyInstance } from 'fastify';
import { RecommendationAdminService } from '../../modules/recommendations/recommendation-admin.service.js';

export async function registerInternalAdminRecommendationRoutes(app: FastifyInstance): Promise<void> {
  const adminService = new RecommendationAdminService();

  app.get('/internal/v1/admin/recommendations/consumers', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['admin:diagnostics:read']);
    const query = asRecord(request.query);
    return adminService.listConsumers(parseLimit(query.limit));
  });

  app.get('/internal/v1/admin/recommendations/work-state', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['admin:diagnostics:read']);
    const query = asRecord(request.query);
    return adminService.getWorkState(parseLimit(query.limit));
  });

  app.get('/internal/v1/admin/recommendations/outbox', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['admin:diagnostics:read']);
    const query = asRecord(request.query);
    return adminService.getOutbox(parseLimit(query.limit));
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
