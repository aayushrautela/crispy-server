import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.logLevel,
  transport:
    env.nodeEnv === 'development'
      ? {
          target: 'pino/file',
          options: { destination: 1 },
        }
      : undefined,
});
