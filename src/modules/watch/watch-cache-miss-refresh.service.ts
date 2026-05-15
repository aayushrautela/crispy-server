import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { parseMediaKey } from '../identity/media-key.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';

export class WatchCacheMissRefreshService {
  constructor(
    private readonly projectionService = new MetadataProjectionService(),
    private readonly cacheService = new WatchMediaCardCacheService(),
  ) {}

  async refreshMissingCards(client: DbClient, missingMediaKeys: string[], language?: string | null): Promise<void> {
    await this.refreshMissingCardsAndReturnRecords(client, missingMediaKeys, language);
  }

  async refreshMissingCardsAndReturnRecords(client: DbClient, missingMediaKeys: string[], language?: string | null): Promise<Map<string, import('./watch-media-card-cache.repo.js').WatchMediaCardCacheRecord>> {
    if (!missingMediaKeys.length) {
      return new Map();
    }

    const identities = missingMediaKeys.map((key) => parseMediaKey(key));
    const projections = await Promise.allSettled(
      identities.map((identity) => this.projectionService.buildWatchProjection(client, identity, language)),
    );

    let refreshed = 0;
    let failed = 0;

    for (let i = 0; i < identities.length; i++) {
      const result = projections[i];
      const identity = identities[i];
      if (!result || !identity) {
        failed++;
        continue;
      }

      if (result.status === 'fulfilled') {
        try {
          await this.cacheService.upsertFromProjection(client, identity, result.value, language);
          refreshed++;
        } catch (error) {
          logger.warn({ error, mediaKey: identity.mediaKey }, 'failed to cache projection');
          failed++;
        }
      } else {
        failed++;
      }
    }

    if (refreshed > 0 || failed > 0) {
      logger.info({ refreshed, failed, total: missingMediaKeys.length }, 'watch cache miss refresh completed');
    }

    return this.cacheService.listCardCacheRecords(client, missingMediaKeys);
  }
}
