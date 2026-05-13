import { appConfig } from '../../../config/app-config.js';
import { env } from '../../../config/env.js';
import { HttpError } from '../../../lib/errors.js';
import { redis } from '../../../lib/redis.js';
import type { DbClient } from '../../../lib/db.js';
import type { TmdbTitleType } from './tmdb.types.js';

export type TmdbCachePolicy = {
  freshMs: number;
  staleMs: number;
  purgeMs: number;
};

export type TmdbCacheSpec = {
  resourceType: string;
  resourceId: string | null;
  variant: string;
  language: string | null;
  requestPath: string;
  requestQuery: Record<string, string | number | undefined>;
};

export type TmdbCachedResponse = {
  cacheKey: string;
  resourceType: string;
  resourceId: string | null;
  variant: string;
  language: string | null;
  requestPath: string;
  requestQuery: Record<string, string | number | undefined>;
  responseJson: Record<string, unknown>;
  statusCode: number;
  isNegative: boolean;
  fetchedAt: string;
  freshUntil: string;
  staleUntil: string;
  purgeAt: string;
  lastError: string | null;
  errorCount: number;
};

const POLICIES: Record<string, TmdbCachePolicy> = {
  'title:movie': { freshMs: 7 * 24 * 60 * 60 * 1000, staleMs: 90 * 24 * 60 * 60 * 1000, purgeMs: 180 * 24 * 60 * 60 * 1000 },
  'title:tv': { freshMs: 24 * 60 * 60 * 1000, staleMs: 90 * 24 * 60 * 60 * 1000, purgeMs: 180 * 24 * 60 * 60 * 1000 },
  'season': { freshMs: 24 * 60 * 60 * 1000, staleMs: 90 * 24 * 60 * 60 * 1000, purgeMs: 180 * 24 * 60 * 60 * 1000 },
  'person': { freshMs: 7 * 24 * 60 * 60 * 1000, staleMs: 90 * 24 * 60 * 60 * 1000, purgeMs: 180 * 24 * 60 * 60 * 1000 },
  'collection': { freshMs: 30 * 24 * 60 * 60 * 1000, staleMs: 90 * 24 * 60 * 60 * 1000, purgeMs: 180 * 24 * 60 * 60 * 1000 },
  'search': { freshMs: 60 * 60 * 1000, staleMs: 7 * 24 * 60 * 60 * 1000, purgeMs: 30 * 24 * 60 * 60 * 1000 },
  'external:positive': { freshMs: 30 * 24 * 60 * 60 * 1000, staleMs: 180 * 24 * 60 * 60 * 1000, purgeMs: 180 * 24 * 60 * 60 * 1000 },
  'external:negative': { freshMs: 6 * 60 * 60 * 1000, staleMs: 24 * 60 * 60 * 1000, purgeMs: 7 * 24 * 60 * 60 * 1000 },
};

function jitterMs(ms: number): number {
  const factor = 0.9 + Math.random() * 0.2;
  return Math.floor(ms * factor);
}

function buildCacheKey(spec: TmdbCacheSpec): string {
  const parts = [
    spec.resourceType,
    spec.resourceId ?? 'null',
    spec.variant,
    spec.language ?? 'null',
    spec.requestPath,
    Object.entries(spec.requestQuery)
      .filter(([_, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&'),
  ];
  return parts.map((p) => Buffer.from(p, 'utf8').toString('base64url')).join(':');
}

function nowIso(): string {
  return new Date().toISOString();
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

export class TmdbResponseCacheService {
  async getOrFetch(
    client: DbClient,
    spec: TmdbCacheSpec,
    policyKey: string,
    fetchFn: () => Promise<Record<string, unknown>>,
  ): Promise<TmdbCachedResponse> {
    const cacheKey = buildCacheKey(spec);
    const lockKey = `tmdb:lock:${cacheKey}`;
    const policy = POLICIES[policyKey] ?? POLICIES['title:movie'];
    if (!policy) {
      throw new Error(`Unknown TMDB cache policy: ${policyKey}`);
    }

    const cached = await this.get(client, cacheKey);
    if (cached) {
      const now = Date.now();
      const freshUntil = Date.parse(cached.freshUntil);
      const staleUntil = Date.parse(cached.staleUntil);

      if (now < freshUntil) {
        return cached;
      }

      if (now < staleUntil) {
        this.scheduleRefresh(cacheKey, spec, policyKey);
        return cached;
      }
    }

    const lockAcquired = await this.acquireLock(lockKey);
    if (!lockAcquired) {
      const stale = await this.get(client, cacheKey);
      if (stale) {
        return stale;
      }
      await this.waitForLock(lockKey);
      return this.getOrFetch(client, spec, policyKey, fetchFn);
    }

    try {
      const responseJson = await fetchFn();
      const now = nowIso();
      const freshUntil = addMs(now, jitterMs(policy.freshMs));
      const staleUntil = addMs(now, jitterMs(policy.staleMs));
      const purgeAt = addMs(now, jitterMs(policy.purgeMs));

      const record: TmdbCachedResponse = {
        cacheKey,
        resourceType: spec.resourceType,
        resourceId: spec.resourceId,
        variant: spec.variant,
        language: spec.language,
        requestPath: spec.requestPath,
        requestQuery: spec.requestQuery,
        responseJson,
        statusCode: 200,
        isNegative: false,
        fetchedAt: now,
        freshUntil,
        staleUntil,
        purgeAt,
        lastError: null,
        errorCount: 0,
      };

      await this.set(client, record);
      return record;
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) {
        const now = nowIso();
        const freshUntil = addMs(now, jitterMs(policy.freshMs));
        const staleUntil = addMs(now, jitterMs(policy.staleMs));
        const purgeAt = addMs(now, jitterMs(policy.purgeMs));

        const negative: TmdbCachedResponse = {
          cacheKey,
          resourceType: spec.resourceType,
          resourceId: spec.resourceId,
          variant: spec.variant,
          language: spec.language,
          requestPath: spec.requestPath,
          requestQuery: spec.requestQuery,
          responseJson: {},
          statusCode: 404,
          isNegative: true,
          fetchedAt: now,
          freshUntil,
          staleUntil,
          purgeAt,
          lastError: error.message,
          errorCount: 1,
        };

        await this.set(client, negative);
        return negative;
      }

      if (cached) {
        return cached;
      }

      throw error;
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  async get(client: DbClient, cacheKey: string): Promise<TmdbCachedResponse | null> {
    const result = await client.query(
      `
        SELECT cache_key, resource_type, resource_id, variant, language, request_path, request_query,
               response_json, status_code, is_negative, fetched_at, fresh_until, stale_until, purge_at,
               last_error, error_count
        FROM tmdb_api_responses
        WHERE cache_key = $1
      `,
      [cacheKey],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      cacheKey: String(row.cache_key),
      resourceType: String(row.resource_type),
      resourceId: row.resource_id as string | null,
      variant: String(row.variant),
      language: row.language as string | null,
      requestPath: String(row.request_path),
      requestQuery: row.request_query as Record<string, string | number | undefined>,
      responseJson: row.response_json as Record<string, unknown>,
      statusCode: Number(row.status_code),
      isNegative: Boolean(row.is_negative),
      fetchedAt: String(row.fetched_at),
      freshUntil: String(row.fresh_until),
      staleUntil: String(row.stale_until),
      purgeAt: String(row.purge_at),
      lastError: row.last_error as string | null,
      errorCount: Number(row.error_count),
    };
  }

  async set(client: DbClient, record: TmdbCachedResponse): Promise<void> {
    await client.query(
      `
        INSERT INTO tmdb_api_responses (
          cache_key, resource_type, resource_id, variant, language, request_path, request_query,
          response_json, status_code, is_negative, fetched_at, fresh_until, stale_until, purge_at,
          last_error, error_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11::timestamptz, $12::timestamptz, $13::timestamptz, $14::timestamptz, $15, $16)
        ON CONFLICT (cache_key)
        DO UPDATE SET
          resource_type = EXCLUDED.resource_type,
          resource_id = EXCLUDED.resource_id,
          variant = EXCLUDED.variant,
          language = EXCLUDED.language,
          request_path = EXCLUDED.request_path,
          request_query = EXCLUDED.request_query,
          response_json = EXCLUDED.response_json,
          status_code = EXCLUDED.status_code,
          is_negative = EXCLUDED.is_negative,
          fetched_at = EXCLUDED.fetched_at,
          fresh_until = EXCLUDED.fresh_until,
          stale_until = EXCLUDED.stale_until,
          purge_at = EXCLUDED.purge_at,
          last_error = EXCLUDED.last_error,
          error_count = EXCLUDED.error_count
      `,
      [
        record.cacheKey,
        record.resourceType,
        record.resourceId,
        record.variant,
        record.language,
        record.requestPath,
        JSON.stringify(record.requestQuery),
        JSON.stringify(record.responseJson),
        record.statusCode,
        record.isNegative,
        record.fetchedAt,
        record.freshUntil,
        record.staleUntil,
        record.purgeAt,
        record.lastError,
        record.errorCount,
      ],
    );
  }

  private async acquireLock(lockKey: string): Promise<boolean> {
    const result = await redis.eval(
      `
        if redis.call('set', KEYS[1], '1', 'NX', 'EX', 10) then
          return 1
        else
          return 0
        end
      `,
      1,
      lockKey,
    );
    return result === 1;
  }

  private async releaseLock(lockKey: string): Promise<void> {
    await redis.del(lockKey);
  }

  private async waitForLock(lockKey: string): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const exists = await redis.get(lockKey);
      if (!exists) {
        return;
      }
    }
  }

  private scheduleRefresh(cacheKey: string, spec: TmdbCacheSpec, policyKey: string): void {
    setTimeout(() => {
      this.enqueueRefreshJob(cacheKey, spec, policyKey).catch((error) => {
        console.error(`Failed to schedule refresh for ${cacheKey}:`, error);
      });
    }, 1000);
  }

  private async enqueueRefreshJob(cacheKey: string, spec: TmdbCacheSpec, policyKey: string): Promise<void> {
    const jobId = Buffer.from(`tmdb-refresh:${cacheKey}`, 'utf8').toString('base64url');
    const queue = (await import('../../../lib/queue.js')).getProjectionQueue();
    await queue.add('tmdb-cache-refresh', { cacheKey, spec, policyKey }, { jobId });
  }
}
