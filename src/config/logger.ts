import pino from 'pino';
import { env } from './env.js';

export const loggerOptions = {
  level: env.logLevel,
  transport:
    env.nodeEnv === 'development'
      ? {
          target: 'pino/file',
          options: { destination: 1 },
        }
      : undefined,
} as const;

export const logger = pino(loggerOptions);
