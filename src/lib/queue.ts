import { Job, Queue, QueueEvents } from 'bullmq';
import { env } from '../config/env.js';

export const projectionQueueName = 'projection-refresh';
export const aiGenerationQueueName = 'ai-generation';

/**
 * AI insight/search generation jobs. Time-bound and must never retry: a retry
 * doubles provider cost and cannot meet the request deadline. `attempts: 1`
 * plus the worker's `maxStalledCount: 0` guarantee a failed/stalled job is
 * failed once and removed (so a later same-key re-enqueue is allowed), never
 * re-run. `timeout` is the BullMQ hard-halt; the in-process executor keeps its
 * own AbortSignal deadline as a backstop.
 */
const AI_JOB_ATTEMPTS = 1;
const AI_JOB_REMOVE_ON_COMPLETE = true;
const AI_JOB_REMOVE_ON_FAIL = true;

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

export type TmdbEntityRefreshJob = {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
};

export type TmdbCacheWarmTitleBatchJob = {
  mediaType: 'movie' | 'tv';
  tmdbIds: number[];
};

export type TmdbImageFetchJob = {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  language?: string | null;
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

export async function enqueueTmdbEntityRefresh(mediaType: 'movie' | 'tv', tmdbId: number): Promise<void> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return;
  }

  await getProjectionQueue().add('tmdb-entity-refresh', { mediaType, tmdbId }, {
    jobId: buildJobId('tmdb-entity-refresh', mediaType, String(tmdbId)),
    removeOnComplete: true,
    removeOnFail: 100,
  });
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

export async function enqueueTmdbImageFetch(mediaType: 'movie' | 'tv', tmdbId: number, language?: string | null): Promise<void> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return;
  }

  await getProjectionQueue().add('tmdb-image-fetch', { mediaType, tmdbId, language }, {
    jobId: buildJobId('tmdb-image-fetch', mediaType, String(tmdbId)),
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

export type AiInsightsJob = {
  userId: string;
  profileId: string;
  itemId: string;
  contentId: string;
  locale: string;
  generationVersion: string;
};

let aiGenerationQueue: Queue | null = null;
let aiGenerationQueueEvents: QueueEvents | null = null;

export function getAiGenerationQueue(): Queue {
  aiGenerationQueue ??= new Queue(aiGenerationQueueName, {
    connection: bullConnection,
  });
  return aiGenerationQueue;
}

export function getAiGenerationQueueEvents(): QueueEvents {
  aiGenerationQueueEvents ??= new QueueEvents(aiGenerationQueueName, {
    connection: bullConnection,
  });
  return aiGenerationQueueEvents;
}

function buildAiInsightsJobId(contentId: string, locale: string, generationVersion: string): string {
  return buildJobId('ai:insights', contentId, locale, generationVersion);
}

export async function enqueueAiInsightsJob(payload: AiInsightsJob): Promise<Job> {
  return getAiGenerationQueue().add('ai-insights', payload, {
    jobId: buildAiInsightsJobId(payload.contentId, payload.locale, payload.generationVersion),
    attempts: AI_JOB_ATTEMPTS,
    removeOnComplete: AI_JOB_REMOVE_ON_COMPLETE,
    removeOnFail: AI_JOB_REMOVE_ON_FAIL,
  });
}


