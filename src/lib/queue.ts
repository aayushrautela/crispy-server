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

export const projectionQueue = new Queue(projectionQueueName, {
  connection: bullConnection,
});

export type ProjectionRefreshJob = {
  profileId: string;
  reason: string;
  mediaKey?: string;
};

export function heartbeatFlushJobId(profileId: string, mediaKey: string): string {
  return `heartbeat-flush:${profileId}:${mediaKey}`;
}

export async function enqueueHeartbeatFlush(profileId: string, mediaKey: string, delayMs?: number): Promise<void> {
  await projectionQueue.add(
    'flush-heartbeat',
    {
      profileId,
      mediaKey,
      reason: 'flush-heartbeat',
    },
    {
      jobId: heartbeatFlushJobId(profileId, mediaKey),
      delay: delayMs ?? HEARTBEAT_POLICY.initialFlushDelayMs,
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}
