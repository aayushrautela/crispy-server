import { withDbClient } from '../../lib/db.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import type { RatingProductItem, WatchlistProductItem } from './watch-derived-item.types.js';
import { WatchQueryService } from './watch-query.service.js';
import type { PaginatedWatchCollection } from './watch-read.types.js';
import { mapRatingRowToProduct, mapWatchlistRowToProduct } from './watch-row-product.mapper.js';
import { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import { fallbackRegularCard } from './regular-card-fallback.js';

export class WatchCollectionService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly watchQueryService = new WatchQueryService(),
    private readonly watchMediaCardCacheService = new WatchMediaCardCacheService(),
  ) {}

  async listWatchlistProducts(userId: string, profileId: string, limit: number): Promise<WatchlistProductItem[]> {
    const page = await this.listWatchlistPage(userId, profileId, { limit });
    return page.items;
  }

  async listWatchlistPage(
    userId: string,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PaginatedWatchCollection<WatchlistProductItem>> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const page = await this.watchQueryService.listWatchlistPage(client, profileId, params);
      const mediaMap = await this.watchMediaCardCacheService.listRegularCards(client, page.items.map((row) => row.mediaKey));
      return {
        items: page.items
          .map((row) => ({ ...row, media: mediaMap.get(row.mediaKey) ?? fallbackRegularCard(row.mediaKey, row.title, row.posterUrl, row.subtitle, row.releaseYear, row.titleRating) }))
          .map((row) => mapWatchlistRowToProduct(row))
          .filter((item): item is WatchlistProductItem => item !== null),
        pageInfo: page.pageInfo,
      };
    });
  }

  async listRatingsProducts(userId: string, profileId: string, limit: number): Promise<RatingProductItem[]> {
    const page = await this.listRatingsPage(userId, profileId, { limit });
    return page.items;
  }

  async listRatingsPage(
    userId: string,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PaginatedWatchCollection<RatingProductItem>> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const page = await this.watchQueryService.listRatingsPage(client, profileId, params);
      const mediaMap = await this.watchMediaCardCacheService.listRegularCards(client, page.items.map((row) => row.mediaKey));
      return {
        items: page.items
          .map((row) => ({ ...row, media: mediaMap.get(row.mediaKey) ?? fallbackRegularCard(row.mediaKey, row.title, row.posterUrl, row.subtitle, row.releaseYear, row.titleRating) }))
          .map((row) => mapRatingRowToProduct(row))
          .filter((item): item is RatingProductItem => item !== null),
        pageInfo: page.pageInfo,
      };
    });
  }
}
