import { withDbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { WatchQueryService } from './watch-query.service.js';
import type { ContinueWatchingProductItem, HistoryProductItem } from './watch-derived-item.types.js';
import type { PaginatedWatchCollection } from './watch-read.types.js';
import {
  diagnoseContinueWatchingRow,
  mapContinueWatchingRowToProduct,
  mapHistoryRowToProduct,
} from './watch-row-product.mapper.js';
import { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import { fallbackRegularCard } from './regular-card-fallback.js';

export class WatchReadService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly watchQueryService = new WatchQueryService(),
    private readonly watchMediaCardCacheService = new WatchMediaCardCacheService(),
  ) {}

  async listContinueWatchingProducts(userId: string, profileId: string, limit: number): Promise<ContinueWatchingProductItem[]> {
    const page = await this.listContinueWatchingPage(userId, profileId, { limit });
    return page.items;
  }

  async countContinueWatchingProducts(userId: string, profileId: string): Promise<number> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);
      return this.watchQueryService.countContinueWatching(client, profileId);
    });
  }

  async listContinueWatchingPage(
    userId: string,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PaginatedWatchCollection<ContinueWatchingProductItem>> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const page = await this.watchQueryService.listContinueWatchingPage(client, profileId, params);
      const items: ContinueWatchingProductItem[] = [];
      let droppedCount = 0;

      for (const row of page.items) {
        const item = mapContinueWatchingRowToProduct(row);
        if (item) {
          items.push(item);
          continue;
        }

        droppedCount += 1;
        const diagnostics = diagnoseContinueWatchingRow(row);
        logger.warn({
          profileId,
          continueWatchingId: row.id,
          mediaKey: row.mediaKey,
          missing: diagnostics.missing,
          provider: diagnostics.provider,
          providerId: diagnostics.providerId,
          titleMediaType: diagnostics.titleMediaType,
          title: row.title,
          posterUrl: row.posterUrl,
          backdropUrl: diagnostics.backdropUrl,
          playbackParentProvider: row.playbackParentProvider,
          playbackParentProviderId: row.playbackParentProviderId,
        }, 'dropped continue watching row with incomplete media');
      }

      if (droppedCount > 0) {
        logger.warn({
          profileId,
          requestedLimit: params.limit,
          sourceRowCount: page.items.length,
          returnedItemCount: items.length,
          droppedCount,
        }, 'continue watching page dropped rows during product mapping');
      }

      return {
        items,
        pageInfo: page.pageInfo,
      };
    });
  }

  async listHistoryProducts(userId: string, profileId: string, limit: number): Promise<HistoryProductItem[]> {
    const page = await this.listHistoryPage(userId, profileId, { limit });
    return page.items;
  }

  async countHistoryProducts(userId: string, profileId: string): Promise<number> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);
      return this.watchQueryService.countWatchHistory(client, profileId);
    });
  }

  async listHistoryPage(
    userId: string,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PaginatedWatchCollection<HistoryProductItem>> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const page = await this.watchQueryService.listWatchHistoryPage(client, profileId, params);
      const mediaMap = await this.watchMediaCardCacheService.listRegularCards(client, page.items.map((row) => row.mediaKey));
      return {
        items: page.items
          .map((row) => ({ ...row, media: mediaMap.get(row.mediaKey) ?? fallbackRegularCard(row.mediaKey, row.title, row.posterUrl, row.subtitle, row.detailsReleaseYear, row.detailsRating) }))
          .map((row) => mapHistoryRowToProduct(row))
          .filter((item): item is HistoryProductItem => item !== null),
        pageInfo: page.pageInfo,
      };
    });
  }
}
