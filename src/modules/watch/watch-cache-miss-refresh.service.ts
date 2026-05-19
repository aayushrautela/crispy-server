import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { parseMediaKey, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';

export class WatchCacheMissRefreshService {
  constructor(
    private readonly projectionService = new MetadataProjectionService(),
    private readonly cacheService = new WatchMediaCardCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async refreshMissingCards(client: DbClient, missingItemIds: string[], language?: string | null): Promise<void> {
    await this.refreshMissingCardsAndReturnRecords(client, missingItemIds, language);
  }

  async refreshMissingCardsAndReturnRecords(client: DbClient, missingItemIds: string[], language?: string | null): Promise<Map<string, import('./watch-media-card-cache.repo.js').WatchMediaCardCacheRecord>> {
    if (!missingItemIds.length) {
      return new Map();
    }

    const identities: MediaIdentity[] = [];
    const failedItemIds: string[] = [];

    for (const itemId of missingItemIds) {
      try {
        const identity = await this.resolveIdentityForRefresh(client, itemId);
        if (identity) {
          identities.push(identity);
        } else {
          failedItemIds.push(itemId);
        }
      } catch {
        failedItemIds.push(itemId);
      }
    }

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
          const titleProviderId = identity.tmdbId
            ? String(identity.tmdbId)
            : (identity.showTmdbId ? String(identity.showTmdbId) : null);

          await this.cacheService.upsertFromProjection(client, {
            itemId: identity.contentId ?? identity.mediaKey,
            mediaType: identity.mediaType,
            titleProvider: 'tmdb',
            titleProviderId,
            titleMediaType: identity.mediaType === 'movie' ? 'movie' : 'show',
          }, result.value, language);
          refreshed++;
        } catch (error) {
          logger.warn({ error, itemId: identity.mediaKey }, 'failed to cache projection');
          failed++;
        }
      } else {
        failed++;
      }
    }

    if (refreshed > 0 || failed > 0) {
      logger.info({ refreshed, failed, total: missingItemIds.length }, 'watch cache miss refresh completed');
    }

    return this.cacheService.listCardCacheRecords(client, missingItemIds, language);
  }

  private async resolveIdentityForRefresh(client: DbClient, publicItemId: string): Promise<MediaIdentity | null> {
    const contentId = assertPublicItemId(publicItemId);
    return this.contentIdentityService.resolveMediaIdentity(client, contentId);
  }
}
