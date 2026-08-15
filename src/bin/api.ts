import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withDbClient, db } from '../lib/db.js';
import { buildApp } from '../http/app.js';
import { assertJwksReachable } from '../lib/jwks-healthcheck.js';
import { imdbRatingsService } from '../modules/metadata/enrichment/imdb-ratings.service.js';
import { LocalUserWatchService } from '../modules/integrations/local-user-watch.service.js';
import { getPlaybackProgressBuffer } from '../modules/watch/playback-progress-buffer.service.js';

await assertJwksReachable();

const app = await buildApp();

withDbClient(async (client) => {
  await imdbRatingsService.initialize(client);
  imdbRatingsService.startPeriodicUpdate(() => db.connect());
}).catch((err) => {
  logger.error({ err }, 'failed to initialize imdb ratings');
});

const playbackProgressBuffer = getPlaybackProgressBuffer(new LocalUserWatchService());
playbackProgressBuffer.flushPendingOnBoot().catch((err) => {
  logger.error({ err }, 'failed to drain buffered playback progress on boot');
});
playbackProgressBuffer.start();

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
