import { appConfig } from '../../config/app-config.js';
import { redis } from '../../lib/redis.js';

export function homeCacheKey(profileId: string, locale: string, region: string | null): string {
  return `home:${profileId}:${locale}:${region ?? 'none'}`;
}

/** Per-profile monotonic epoch stored in Redis. Bumped on every home
 *  invalidation so an in-flight rebuild can detect that a write landed
 *  during its build and skip clobbering the newer payload. Shared across
 *  API/worker processes because it lives in Redis. */
function homeEpochKey(profileId: string): string {
  return `home:epoch:${profileId}`;
}

export async function readHomeEpoch(profileId: string): Promise<number> {
  const raw = await redis.get(homeEpochKey(profileId));
  if (raw == null) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Delete every rendered home payload for a profile and bump its invalidation
 * epoch. The cache key is versioned by locale/region, so a single `del` is not
 * enough — scan the profile's key space and drop the base key as well for
 * backwards compatibility with older payloads.
 *
 * The epoch bump must happen AFTER the dels so a rebuild that reads the epoch
 * after this call observes the new value and skips writing a stale payload.
 */
export async function invalidateHomeCache(profileId: string): Promise<void> {
  const pattern = `home:${profileId}:*`;
  const keys = await redis.keys(pattern);
  const legacyKey = `home:${profileId}`;
  if (keys.length) {
    await redis.del(...keys);
  }
  await redis.del(legacyKey);
  await redis.incr(homeEpochKey(profileId));
}
