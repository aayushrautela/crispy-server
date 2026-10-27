import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { RateLimitExceededError } from '../../lib/errors.js';
import type { RateLimitStore } from '../../modules/apps/app-rate-limit.service.js';
import type { Clock } from '../../modules/apps/clock.js';

/**
 * Global (per-client) rate limits for the unauthenticated / brute-force
 * sensitive surfaces of the API. These limits complement the per-app limits
 * from `DefaultAppRateLimitService`: they protect endpoints that are reachable
 * without an app key (admin login, PIN verification, device-code exchange) and
 * keep a single client from flooding the JWT-protected `/v1` surface.
 *
 * The client identity is the peer address reported by Fastify (`request.ip`).
 * Deployments behind a reverse proxy must enable `trustProxy` so the real
 * client address is used instead of the proxy address.
 */
export type GlobalRateLimitBucket =
  | 'admin.login'
  | 'v1.pin.verify'
  | 'v1.pat.mint'
  | 'v1.device.code'
  | 'v1.api';

export interface GlobalRateLimitRule {
  bucket: GlobalRateLimitBucket;
  capacity: number;
  windowSeconds: number;
}

export const GLOBAL_RATE_LIMIT_RULES: Record<GlobalRateLimitBucket, GlobalRateLimitRule> = {
  'admin.login': { bucket: 'admin.login', capacity: 10, windowSeconds: 300 },
  'v1.pin.verify': { bucket: 'v1.pin.verify', capacity: 10, windowSeconds: 300 },
  'v1.pat.mint': { bucket: 'v1.pat.mint', capacity: 10, windowSeconds: 3600 },
  'v1.device.code': { bucket: 'v1.device.code', capacity: 60, windowSeconds: 600 },
  'v1.api': { bucket: 'v1.api', capacity: 600, windowSeconds: 60 },
};

const PIN_VERIFY_PATTERN = /^\/v1\/profiles\/[^/]+\/pin\/verify$/;
const DEVICE_CODE_PATTERN = /^\/v1\/auth\/device(?:\/|$)/;

/**
 * Maps a request onto the global rate limit buckets it consumes. More specific
 * buckets are returned first; `/v1` requests additionally consume the general
 * `v1.api` bucket.
 */
export function classifyGlobalRateLimitRoute(method: string, url: string): GlobalRateLimitBucket[] {
  const path = url.split('?')[0] ?? url;
  const upperMethod = method.toUpperCase();
  const buckets: GlobalRateLimitBucket[] = [];

  if (upperMethod === 'POST' && path === '/admin/login') {
    buckets.push('admin.login');
  }

  if (path.startsWith('/v1/')) {
    if (upperMethod === 'POST' && path === '/v1/auth/personal-access-tokens') {
      buckets.push('v1.pat.mint');
    }
    if (DEVICE_CODE_PATTERN.test(path)) {
      buckets.push('v1.device.code');
    }
    if (upperMethod === 'POST' && PIN_VERIFY_PATTERN.test(path)) {
      buckets.push('v1.pin.verify');
    }
    buckets.push('v1.api');
  }

  return buckets;
}

export interface GlobalRateLimitPluginOptions {
  store: RateLimitStore;
  clock: Clock;
}

const globalRateLimitPlugin: FastifyPluginAsync<GlobalRateLimitPluginOptions> = async (fastify, options) => {
  const { store, clock } = options;

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const buckets = classifyGlobalRateLimitRoute(request.method, request.url);
    if (buckets.length === 0) {
      return;
    }

    for (const bucket of buckets) {
      const rule = GLOBAL_RATE_LIMIT_RULES[bucket];
      const now = clock.now();
      const window = Math.floor(now.getTime() / (rule.windowSeconds * 1000));
      const key = ['global-rate-limit', bucket, request.ip, window].join(':');
      const result = await store.increment({ key, windowSeconds: rule.windowSeconds, cost: 1, now });

      if (result.count > rule.capacity) {
        const retryAfterSeconds = Math.max(Math.ceil((result.resetAt.getTime() - now.getTime()) / 1000), 1);
        throw new RateLimitExceededError(retryAfterSeconds);
      }
    }
  });
};

export default fp(globalRateLimitPlugin, { name: 'global-rate-limit-plugin' });
