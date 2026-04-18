import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { HEARTBEAT_POLICY } from '../modules/watch/heartbeat-policy.js';

export const projectionQueueName = 'projection-refresh';
export const recommendationQueueName = 'recommendation-generation';

const redisUrl = new URL(env.redisUrl);

export const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname && redisUrl.pathname !== '/' ? Number(redisUrl.pathname.slice(1)) : 0,
};

let projectionQueue: Queue | null = null;
let recommendationQueue: Queue | null = null;

export type ProjectionRefreshJob = {
  profileId: string;
  reason: string;
  mediaKey?: string;
  importJobId?: string;
  provider?: string;
};

export type RecommendationOrchestrationJob = {
  jobId: string;
  reason: 'recommendation-submit' | 'recommendation-sync';
};

export type RecommendationQueueStrategy = 'dedupe' | 'followup';

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

export function heartbeatFlushJobId(profileId: string, mediaKey: string): string {
  return buildJobId('heartbeat-flush', profileId, mediaKey);
}

export async function enqueueHeartbeatFlush(profileId: string, mediaKey: string, delayMs?: number): Promise<void> {
  await enqueueProjectionRefreshJob(
    {
      profileId,
      mediaKey,
      reason: 'flush-heartbeat',
    },
    {
      delayMs: delayMs ?? HEARTBEAT_POLICY.initialFlushDelayMs,
    },
  );
}

export async function enqueueRefreshCalendarCache(profileId: string): Promise<void> {
  await enqueueProjectionRefreshJob({ profileId, reason: 'refresh-calendar-cache' });
}

export async function enqueueMetadataRefresh(profileId: string, mediaKey?: string): Promise<void> {
  await enqueueProjectionRefreshJob({ profileId, mediaKey, reason: 'metadata-refresh' });
}

export async function enqueueRebuildProfileProjections(profileId: string): Promise<void> {
  await enqueueProjectionRefreshJob({ profileId, reason: 'rebuild-profile-projections' });
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

export async function enqueueRecommendationSubmit(
  jobId: string,
  delayMs?: number,
  strategy: RecommendationQueueStrategy = 'dedupe',
): Promise<void> {
  await enqueueRecommendationJob({ jobId, reason: 'recommendation-submit' }, delayMs, strategy);
}

export async function enqueueRecommendationSync(
  jobId: string,
  delayMs?: number,
  strategy: RecommendationQueueStrategy = 'dedupe',
): Promise<void> {
  await enqueueRecommendationJob({ jobId, reason: 'recommendation-sync' }, delayMs, strategy);
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

async function enqueueRecommendationJob(
  job: RecommendationOrchestrationJob,
  delayMs?: number,
  strategy: RecommendationQueueStrategy = 'dedupe',
): Promise<void> {
  if (env.nodeEnv === 'test') {
    return;
  }

  const queue = getRecommendationQueue();
  const requestedDelayMs = Math.max(0, Math.trunc(delayMs ?? 0));
  const baseJobId = buildJobId(job.reason, job.jobId);

  if (strategy === 'followup') {
    await addRecommendationQueueJob(queue, job, requestedDelayMs, buildJobId(job.reason, job.jobId, randomUUID()));
    return;
  }

  const existing = await queue.getJob(baseJobId);
  if (!existing) {
    await addRecommendationQueueJob(queue, job, requestedDelayMs, baseJobId);
    return;
  }

  const state = await existing.getState();
  if (state === 'failed' || state === 'completed') {
    await existing.remove();
    await addRecommendationQueueJob(queue, job, requestedDelayMs, baseJobId);
    return;
  }

  if (state === 'delayed') {
    const scheduledAt = Number(existing.timestamp ?? Date.now()) + Number(existing.opts.delay ?? 0);
    const remainingDelayMs = Math.max(0, scheduledAt - Date.now());
    if (requestedDelayMs < remainingDelayMs) {
      await existing.changeDelay(requestedDelayMs);
    }
  }
}

async function addRecommendationQueueJob(
  queue: Queue,
  job: RecommendationOrchestrationJob,
  delayMs: number,
  jobId: string,
): Promise<void> {
  await queue.add(job.reason, job, {
    jobId,
    delay: delayMs,
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

function buildJobId(...parts: string[]): string {
  return parts.map((part) => Buffer.from(part, 'utf8').toString('base64url')).join('__');
}

function getProjectionQueue(): Queue {
  projectionQueue ??= new Queue(projectionQueueName, {
    connection: bullConnection,
  });
  return projectionQueue;
}

function getRecommendationQueue(): Queue {
  recommendationQueue ??= new Queue(recommendationQueueName, {
    connection: bullConnection,
  });
  return recommendationQueue;
}
