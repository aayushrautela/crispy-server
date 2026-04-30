import type { Clock } from './clock.js';
import type { AppPrincipal, AppRateLimitRouteGroup } from './app-principal.types.js';

export interface AppRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining?: number;
  resetAt?: Date;
}

export interface AppRateLimitService {
  checkAndConsume(input: {
    principal: AppPrincipal;
    routeGroup: AppRateLimitRouteGroup;
    accountId?: string;
    profileId?: string;
    listKey?: string;
    runId?: string;
    cost?: number;
  }): Promise<AppRateLimitDecision>;
}

export interface RateLimitStore {
  increment(input: { key: string; windowSeconds: number; cost: number; now: Date }): Promise<{ count: number; resetAt: Date }>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: Date }>();

  async increment(input: { key: string; windowSeconds: number; cost: number; now: Date }): Promise<{ count: number; resetAt: Date }> {
    const existing = this.entries.get(input.key);
    if (!existing || existing.resetAt <= input.now) {
      const resetAt = new Date(input.now.getTime() + input.windowSeconds * 1000);
      const next = { count: input.cost, resetAt };
      this.entries.set(input.key, next);
      return next;
    }
    existing.count += input.cost;
    return existing;
  }
}

export class DefaultAppRateLimitService implements AppRateLimitService {
  constructor(private readonly deps: { store: RateLimitStore; clock: Clock }) {}

  async checkAndConsume(input: {
    principal: AppPrincipal;
    routeGroup: AppRateLimitRouteGroup;
    accountId?: string;
    profileId?: string;
    listKey?: string;
    runId?: string;
    cost?: number;
  }): Promise<AppRateLimitDecision> {
    const limit = getLimit(input.principal, input.routeGroup);
    if (!limit) {
      return { allowed: true };
    }

    const now = this.deps.clock.now();
    const key = [
      'app-rate-limit',
      input.principal.appId,
      input.routeGroup,
      input.accountId ?? '-',
      input.profileId ?? '-',
      input.listKey ?? '-',
      input.runId ?? '-',
      Math.floor(now.getTime() / (limit.windowSeconds * 1000)),
    ].join(':');
    const cost = input.cost ?? 1;
    const result = await this.deps.store.increment({ key, windowSeconds: limit.windowSeconds, cost, now });
    const remaining = Math.max(limit.capacity - result.count, 0);

    if (result.count > limit.capacity) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(Math.ceil((result.resetAt.getTime() - now.getTime()) / 1000), 1),
        remaining,
        resetAt: result.resetAt,
      };
    }

    return { allowed: true, remaining, resetAt: result.resetAt };
  }
}

function getLimit(principal: AppPrincipal, routeGroup: AppRateLimitRouteGroup): { capacity: number; windowSeconds: number } | null {
  const policy = principal.rateLimitPolicy;
  switch (routeGroup) {
    case 'profiles.eligible.changes':
      return { capacity: policy.profileChangesReadsPerMinute, windowSeconds: 60 };
    case 'profiles.signals':
      return { capacity: policy.profileSignalReadsPerMinute, windowSeconds: 60 };
    case 'recommendations.service-lists':
    case 'recommendations.single-write':
      return { capacity: policy.recommendationWritesPerMinute, windowSeconds: 60 };
    case 'recommendations.batch-write':
    case 'recommendations.batches':
      return { capacity: policy.batchWritesPerMinute, windowSeconds: 60 };
    case 'confidential.config-bundle':
      return { capacity: policy.configBundleReadsPerMinute, windowSeconds: 60 };
    case 'recommendations.runs':
      return { capacity: policy.runsPerHour, windowSeconds: 3600 };
    case 'profiles.eligible.snapshots':
      return { capacity: policy.snapshotsPerDay, windowSeconds: 86400 };
    case 'apps.self':
    case 'recommendations.backfills':
    case 'apps.audit':
      return null;
  }
}
