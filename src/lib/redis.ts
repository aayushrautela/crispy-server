import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableOfflineQueue: env.nodeEnv !== 'test',
  retryStrategy: env.nodeEnv === 'test' ? () => null : undefined,
});
