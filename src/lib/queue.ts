import { Queue } from 'bullmq';
import { env } from '../config/env.js';

export const projectionQueueName = 'projection-refresh';

const redisUrl = new URL(env.redisUrl);

export const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname && redisUrl.pathname !== '/' ? Number(redisUrl.pathname.slice(1)) : 0,
};

let projectionQueue: Queue | null = null;

export type ProjectionRefreshJob = {
  profileId: string;
  reason: string;
  mediaKey?: string;
  importJobId?: string;
  provider?: string;
};

export type TmdbCacheRefreshJob = {
  cacheKey: string;
  spec: {
    resourceType: string;
    resourceId: string | null;
    variant: string;
    language: string | null;
    requestPath: string;
    requestQuery: Record<string, string | number | undefined>;
  };
  policyKey: string;
};

export type TmdbCacheWarmTitleBatchJob = {
  mediaType: 'movie' | 'tv';
  tmdbIds: number[];
};

export type TmdbCacheWarmSeasonBatchJob = {
  showTmdbId: number;
  seasonNumbers: number[];
};

export type TmdbCachePurgeExpiredJob = {
  limit: number;
};

function projectionRefreshJobId(reason: string, profileId: string, mediaKey?: string): string {
  return mediaKey ? buildJobId(reason, profileId, mediaKey) : buildJobId(reason, profileId);
}

async function enqueueProjectionRefreshJob(job: ProjectionRefreshJob, options?: { delayMs?: number }): Promise<void> {
  await getProjectionQueue().add(job.reason, job, {
    jobId: resolveProjectionJobId(job),
    delay: options?.delayMs,
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

export async function enqueueRefreshCalendarCache(profileId: string): Promise<void> {
  await enqueueProjectionRefreshJob({ profileId, reason: 'refresh-calendar-cache' });
}

export async function enqueueProviderImport(profileId: string, importJobId: string): Promise<void> {
  await enqueueProjectionRefreshJob({ profileId, importJobId, reason: 'provider-import' });
}

export async function enqueueProviderRefresh(profileId: string, provider: string, delayMs?: number): Promise<void> {
  await enqueueProjectionRefreshJob(
    { profileId, provider, reason: 'provider-refresh' },
    { delayMs },
  );
}

export async function enqueueTmdbTitleWarmBatch(mediaType: 'movie' | 'tv', tmdbIds: number[]): Promise<void> {
  const ids = Array.from(new Set(tmdbIds.filter((id) => Number.isInteger(id) && id > 0))).sort((left, right) => left - right);
  if (ids.length === 0) {
    return;
  }

  await getProjectionQueue().add('tmdb-cache-warm-title-batch', { mediaType, tmdbIds: ids }, {
    jobId: buildJobId('tmdb-cache-warm-title-batch', mediaType, ids.join(',')),
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

export async function enqueueTmdbSeasonWarmBatch(showTmdbId: number, seasonNumbers: number[]): Promise<void> {
  const seasons = Array.from(new Set(seasonNumbers.filter((id) => Number.isInteger(id) && id > 0))).sort((left, right) => left - right);
  if (!Number.isInteger(showTmdbId) || showTmdbId <= 0 || seasons.length === 0) {
    return;
  }

  await getProjectionQueue().add('tmdb-cache-warm-season-batch', { showTmdbId, seasonNumbers: seasons }, {
    jobId: buildJobId('tmdb-cache-warm-season-batch', String(showTmdbId), seasons.join(',')),
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

export async function enqueueTmdbPurgeExpired(limit = 1000): Promise<void> {
  await getProjectionQueue().add('tmdb-cache-purge-expired', { limit }, {
    jobId: buildJobId('tmdb-cache-purge-expired'),
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

function resolveProjectionJobId(job: ProjectionRefreshJob): string {
  if (job.importJobId) {
    return buildJobId(job.reason, job.profileId, job.importJobId);
  }

  if (job.provider) {
    return buildJobId(job.reason, job.profileId, job.provider);
  }

  return projectionRefreshJobId(job.reason, job.profileId, job.mediaKey);
}

function buildJobId(...parts: string[]): string {
  return parts.map((part) => Buffer.from(part, 'utf8').toString('base64url')).join('__');
}

export function getProjectionQueue(): Queue {
  projectionQueue ??= new Queue(projectionQueueName, {
    connection: bullConnection,
  });
  return projectionQueue;
}

export const homeQueueName = 'home';

let homeQueue: Queue | null = null;

export function getHomeQueue(): Queue {
  homeQueue ??= new Queue(homeQueueName, {
    connection: bullConnection,
  });
  return homeQueue;
}

export type HomeSeedJob = {
  accountId: string;
  profileId: string;
};

export async function enqueueHomeSeed(job: HomeSeedJob): Promise<string> {
  const jobId = buildJobId('home-seed', job.accountId, job.profileId);
  await getHomeQueue().add('home-seed', job, {
    jobId,
    removeOnComplete: true,
    removeOnFail: 100,
  });
  return jobId;
}

