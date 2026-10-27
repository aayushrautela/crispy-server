import type { RateLimitStore } from '../modules/apps/app-rate-limit.service.js';
import type { RedisLike } from './redis.js';

/**
 * Redis-backed rate limit store.
 *
 * The counter key already embeds the window bucket (see
 * `DefaultAppRateLimitService.checkAndConsume`), so every window gets its own
 * Redis key and expires naturally. `SET ... EX ... NX` only installs the TTL
 * when the key is missing, which keeps the window anchored to the first hit
 * instead of being extended by every request.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisLike) {}

  async increment(input: { key: string; windowSeconds: number; cost: number; now: Date }): Promise<{ count: number; resetAt: Date }> {
    const bucket = Math.floor(input.now.getTime() / (input.windowSeconds * 1000));
    const resetAtMs = (bucket + 1) * input.windowSeconds * 1000;
    const ttlSeconds = Math.max(1, Math.ceil((resetAtMs - input.now.getTime()) / 1000));

    await this.redis.set(input.key, '0', 'EX', String(ttlSeconds), 'NX');
    const count = await this.redis.incrby(input.key, input.cost);

    return { count, resetAt: new Date(resetAtMs) };
  }
}
