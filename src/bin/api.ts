import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { buildApp } from '../http/app.js';

const app = await buildApp();

try {
  await app.listen({
    host: env.serverHost,
    port: env.serverPort,
  });
  logger.info({ host: env.serverHost, port: env.serverPort }, 'api listening');
} catch (error) {
  logger.error({ err: error }, 'failed to start api');
  process.exit(1);
}
