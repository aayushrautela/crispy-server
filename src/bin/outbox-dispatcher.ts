import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { OutboxDispatcher } from '../modules/outbox/outbox-dispatcher.js';

if (!env.outboxDispatcherEnabled) {
  logger.info('outbox dispatcher disabled');
  process.exit(0);
}

if (!env.recommenderInternalBaseUrl) {
  logger.error('RECOMMENDER_INTERNAL_BASE_URL is required when outbox dispatcher is enabled');
  process.exit(1);
}

if (!env.mainToRecommenderServiceToken) {
  logger.error('MAIN_TO_RECOMMENDER_SERVICE_TOKEN is required when outbox dispatcher is enabled');
  process.exit(1);
}

const dispatcher = new OutboxDispatcher({
  batchSize: env.outboxDispatchBatchSize,
  intervalMs: env.outboxDispatchIntervalMs,
  lockSeconds: env.outboxDispatchLockSeconds,
  maxAttempts: env.outboxDispatchMaxAttempts,
  retryBaseMs: env.outboxDispatchRetryBaseMs,
  retryMaxMs: env.outboxDispatchRetryMaxMs,
});

dispatcher.start();

logger.info('outbox dispatcher started');

process.on('SIGTERM', async () => {
  logger.info('received SIGTERM, shutting down');
  await dispatcher.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('received SIGINT, shutting down');
  await dispatcher.close();
  process.exit(0);
});
