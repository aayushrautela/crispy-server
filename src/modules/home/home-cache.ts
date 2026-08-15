import { redis } from '../../lib/redis.js';

export function homeCacheKey(profileId: string, locale: string, region: string | null): string {
  return `home:${profileId}:${locale}:${region ?? 'none'}`;
}

/**
 * Delete every rendered home payload for a profile. The cache key is versioned by
 * locale/region, so a single `del` is not enough — scan the profile's key space and
 * drop the base key as well for backwards compatibility with older payloads.
 */
export async function invalidateHomeCache(profileId: string): Promise<void> {
  const pattern = `home:${profileId}:*`;
  const keys = await redis.keys(pattern);
  const legacyKey = `home:${profileId}`;
    if (keys.length) {
      await redis.del(...keys);
    }
  await redis.del(legacyKey);
}
