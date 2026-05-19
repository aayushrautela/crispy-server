import { redis } from '../../lib/redis.js';
import { metadataTitlePageCacheIndexKey } from './metadata-title-cache-keys.js';

const TITLE_PAGE_TTL_SECONDS = 6 * 60 * 60;

const inFlightRequests = new Map<string, Promise<unknown>>();

export class MetadataTitleCacheService {
  async get<T>(cacheKey: string): Promise<T | null> {
    const cached = await redis.get(cacheKey);
    if (!cached) {
      return null;
    }
    return JSON.parse(cached) as T;
  }

  async set<T>(cacheKey: string, payload: T, itemId?: string, ttlSeconds = TITLE_PAGE_TTL_SECONDS): Promise<T> {
    await redis.set(cacheKey, JSON.stringify(payload), 'EX', ttlSeconds);
    if (itemId) {
      await redis.sadd(metadataTitlePageCacheIndexKey(itemId), cacheKey);
    }
    return payload;
  }

  async getOrSet<T>(cacheKey: string, itemId: string, build: () => Promise<T>, ttlSeconds = TITLE_PAGE_TTL_SECONDS): Promise<T> {
    const cached = await this.get<T>(cacheKey);
    if (cached) {
      return cached;
    }

    const existing = inFlightRequests.get(cacheKey) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        const value = await build();
        await this.set(cacheKey, value, itemId, ttlSeconds);
        return value;
      } finally {
        inFlightRequests.delete(cacheKey);
      }
    })();

    inFlightRequests.set(cacheKey, promise);
    return promise;
  }

  async invalidate(cacheKey: string): Promise<void> {
    inFlightRequests.delete(cacheKey);
    await redis.del(cacheKey);
  }

  async invalidateByItemId(itemId: string): Promise<void> {
    const indexKey = metadataTitlePageCacheIndexKey(itemId);
    const cacheKeys = await redis.smembers(indexKey);
    if (!cacheKeys.length) {
      return;
    }

    for (const cacheKey of cacheKeys) {
      inFlightRequests.delete(cacheKey);
    }

    await redis.del(...cacheKeys, indexKey);
  }
}
