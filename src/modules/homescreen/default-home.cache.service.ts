import { withDbClient } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import type { ClientHomeSection } from '../recommendations/client-home.types.js';
import { DefaultSnapshotsRepository } from './repos/default-snapshots.repo.js';
import type { DefaultSnapshotRecord } from './homescreen.types.js';

const DEFAULT_TTL_SECONDS = env.homescreenDefaultTtlSeconds;
const redisKey = (locale: string) => `homescreen:default:${locale}`;

type CacheEntry = {
  sections: ClientHomeSection[];
  generatedAt: string;
};

export class DefaultHomeCacheService {
  constructor(
    private readonly snapshotsRepository = new DefaultSnapshotsRepository(),
  ) {}

  /** Returns the cached default home for a locale if present and unexpired. */
  async getBuilt(locale: string): Promise<CacheEntry | null> {
    const cached = await this.readRedis(locale);
    if (cached) {
      return cached;
    }
    const record = await withDbClient((client) => this.snapshotsRepository.get(client, locale));
    if (record && !isExpired(record)) {
      await this.writeRedis(locale, { sections: record.sections, generatedAt: record.generatedAt });
      return { sections: record.sections, generatedAt: record.generatedAt };
    }
    return null;
  }

  async storeBuilt(locale: string, sections: ClientHomeSection[], updatedBy: string | null): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_TTL_SECONDS * 1000);
    await withDbClient((client) =>
      this.snapshotsRepository.upsert(client, {
        locale,
        sections,
        generatedAt: now,
        expiresAt,
        lastError: null,
        updatedBy,
      }),
    );
    await this.writeRedis(locale, { sections, generatedAt: now.toISOString() });
  }

  async storeError(locale: string, error: string, updatedBy: string | null): Promise<void> {
    await withDbClient((client) =>
      this.snapshotsRepository.upsert(client, {
        locale,
        sections: [],
        generatedAt: new Date(),
        lastError: error,
        updatedBy,
      }),
    );
  }

  /** Drop the cache so the next request rebuilds. */
  async invalidate(locale: string): Promise<void> {
    await redis.del(redisKey(locale));
    await withDbClient((client) => this.snapshotsRepository.delete(client, locale));
  }

  async invalidateAll(): Promise<void> {
    const records = await withDbClient((client) => this.snapshotsRepository.listLocales(client));
    await redis.del(...records.map((record) => redisKey(record.locale)));
    await withDbClient((client) => {
      return Promise.all(records.map((record) => this.snapshotsRepository.delete(client, record.locale)));
    });
  }

  private async readRedis(locale: string): Promise<CacheEntry | null> {
    const raw = await redis.get(redisKey(locale));
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as CacheEntry;
      if (!Array.isArray(parsed.sections)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeRedis(locale: string, entry: CacheEntry): Promise<void> {
    await redis.set(redisKey(locale), JSON.stringify(entry), 'EX', DEFAULT_TTL_SECONDS);
  }
}

function isExpired(record: DefaultSnapshotRecord): boolean {
  if (!record.expiresAt) {
    return false;
  }
  return new Date(record.expiresAt).getTime() <= Date.now();
}
