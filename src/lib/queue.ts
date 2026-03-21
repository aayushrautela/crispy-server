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

export const projectionQueue = new Queue(projectionQueueName, {
  connection: bullConnection,
});

export type ProjectionRefreshJob = {
  profileId: string;
  reason: string;
};
