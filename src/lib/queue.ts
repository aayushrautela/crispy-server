import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { HEARTBEAT_POLICY } from '../modules/watch/heartbeat-policy.js';

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
  connectionId?: string;
};

function projectionRefreshJobId(reason: string, profileId: string, mediaKey?: string): string {
  return mediaKey ? `${reason}:${profileId}:${mediaKey}` : `${reason}:${profileId}`;
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
  return `heartbeat-flush:${profileId}:${mediaKey}`;
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

export async function enqueueRefreshHomeCache(profileId: string): Promise<void> {
  await enqueueProjectionRefreshJob({ profileId, reason: 'refresh-home-cache' });
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

export async function enqueueProviderRefresh(profileId: string, connectionId: string, delayMs?: number): Promise<void> {
  await enqueueProjectionRefreshJob(
    { profileId, connectionId, reason: 'provider-refresh' },
    { delayMs },
  );
}

function resolveProjectionJobId(job: ProjectionRefreshJob): string {
  if (job.importJobId) {
    return `${job.reason}:${job.profileId}:${job.importJobId}`;
  }

  if (job.connectionId) {
    return `${job.reason}:${job.profileId}:${job.connectionId}`;
  }

  return projectionRefreshJobId(job.reason, job.profileId, job.mediaKey);
}

function getProjectionQueue(): Queue {
  projectionQueue ??= new Queue(projectionQueueName, {
    connection: bullConnection,
  });
  return projectionQueue;
}
