import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { RecommendationWorkService } from '../../modules/recommendations/recommendation-work.service.js';

export async function registerRecommendationWorkRoutes(app: FastifyInstance): Promise<void> {
  const workService = new RecommendationWorkService();

  app.post('/internal/v1/recommendation-work/claim', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['recommendation-work:claim']);
    return workService.claimWork(request.auth!, parseClaimInput(request.body));
  });

  app.post('/internal/v1/recommendation-work/renew', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['recommendation-work:renew']);
    return {
      lease: await workService.renewLease(request.auth!, parseLeaseInput(request.body, 'renew')),
    };
  });

  app.post('/internal/v1/recommendation-work/complete', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['recommendation-work:complete']);
    return {
      workState: await workService.completeLease(request.auth!, parseLeaseInput(request.body, 'complete')),
    };
  });

  app.post('/v1/recommendation-work/claim', async (request) => {
    await app.requireAuth(request);
    app.requireScopes(request, ['recommendation-work:claim']);
    return workService.claimWork(request.auth!, parseClaimInput(request.body));
  });

  app.post('/v1/recommendation-work/renew', async (request) => {
    await app.requireAuth(request);
    app.requireScopes(request, ['recommendation-work:renew']);
    return {
      lease: await workService.renewLease(request.auth!, parseLeaseInput(request.body, 'renew')),
    };
  });

  app.post('/v1/recommendation-work/complete', async (request) => {
    await app.requireAuth(request);
    app.requireScopes(request, ['recommendation-work:complete']);
    return {
      workState: await workService.completeLease(request.auth!, parseLeaseInput(request.body, 'complete')),
    };
  });
}

function parseClaimInput(body: unknown) {
  const value = asRecord(body);
  return {
    workerId: typeof value.workerId === 'string' && value.workerId.trim() ? value.workerId.trim() : `worker-${randomUUID()}`,
    limit: clampLimit(parseNumber(value.limit) ?? 25, 1, 100),
    leaseTtlSeconds: clampLimit(parseNumber(value.leaseTtlSeconds) ?? 120, 15, 900),
    sourceKey: typeof value.sourceKey === 'string' ? value.sourceKey : null,
  };
}

function parseLeaseInput(body: unknown, mode: 'renew' | 'complete') {
  const value = asRecord(body);
  const consumerId = typeof value.consumerId === 'string' ? value.consumerId : null;
  const profileId = typeof value.profileId === 'string' ? value.profileId : null;
  const leaseId = typeof value.leaseId === 'string' ? value.leaseId : null;
  if (!consumerId || !profileId || !leaseId) {
    throw new HttpError(400, 'consumerId, profileId, and leaseId are required.');
  }

  return {
    consumerId,
    profileId,
    leaseId,
    workerId: typeof value.workerId === 'string' && value.workerId.trim() ? value.workerId.trim() : 'worker-unknown',
    leaseTtlSeconds: mode === 'renew' ? clampLimit(parseNumber(value.leaseTtlSeconds) ?? 120, 15, 900) : 120,
    sourceKey: typeof value.sourceKey === 'string' ? value.sourceKey : null,
  };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
