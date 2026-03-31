import { withDbClient } from '../../lib/db.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import type { RatingProductItem, WatchlistProductItem } from './watch-derived-item.types.js';
import { WatchQueryService } from './watch-query.service.js';
import { mapRatingRowToProduct, mapWatchlistRowToProduct } from './watch-row-product.mapper.js';

export class WatchCollectionService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly watchQueryService = new WatchQueryService(),
  ) {}

  async listWatchlistProducts(userId: string, profileId: string, limit: number): Promise<WatchlistProductItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.watchQueryService.listWatchlist(client, profileId, limit);
      return rows
        .map((row) => mapWatchlistRowToProduct(row))
        .filter((item): item is WatchlistProductItem => item !== null);
    });
  }

  async listRatingsProducts(userId: string, profileId: string, limit: number): Promise<RatingProductItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.watchQueryService.listRatings(client, profileId, limit);
      return rows
        .map((row) => mapRatingRowToProduct(row))
        .filter((item): item is RatingProductItem => item !== null);
    });
  }
}
