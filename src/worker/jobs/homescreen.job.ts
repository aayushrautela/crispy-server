import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { DefaultHomeBuilder } from '../../modules/homescreen/default-home.builder.js';
import { DefaultHomeCacheService } from '../../modules/homescreen/default-home.cache.service.js';
import { TraktListImporter } from '../../modules/homescreen/trakt/trakt-list-importer.js';

type HomescreenJob =
  | { reason: 'homescreen-trakt-sync'; importId: string }
  | { reason: 'homescreen-trakt-sync-all' }
  | { reason: 'homescreen-default-rebuild' };

export async function runHomescreenJob(job: HomescreenJob): Promise<void> {
  switch (job.reason) {
    case 'homescreen-trakt-sync':
      await runHomescreenTraktSync(job.importId);
      return;
    case 'homescreen-trakt-sync-all': {
      const importer = new TraktListImporter();
      const synced = await importer.syncAll();
      logger.info({ synced }, 'homescreen trakt sync-all completed');
      return;
    }
    case 'homescreen-default-rebuild':
      await runHomescreenDefaultRebuild();
      return;
    default:
      throw new Error(`Unsupported homescreen job reason: ${(job as { reason: string }).reason}`);
  }
}

async function runHomescreenTraktSync(importId: string): Promise<void> {
  const importer = new TraktListImporter();
  const result = await importer.syncImport(importId);
  logger.info({ importId, ...result }, 'homescreen trakt sync completed');
}

async function runHomescreenDefaultRebuild(): Promise<void> {
  const builder = new DefaultHomeBuilder();
  const cache = new DefaultHomeCacheService();
  const locales = ['all'];
  let synced = 0;
  for (const locale of locales) {
    const sections = await builder.build(locale, null);
    await cache.storeBuilt(locale, sections, 'cron');
    synced += 1;
  }
  logger.info({ locales: synced }, 'homescreen default rebuild completed');
}

export function getCronExpressions(): { traktSync: string; defaultRebuild: string } {
  return {
    traktSync: env.homescreenTraktSyncCron,
    defaultRebuild: env.homescreenDefaultRebuildCron,
  };
}
