import { withDbClient } from '../../lib/db.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { WatchQueryService } from './watch-query.service.js';
import type { ContinueWatchingProductItem, WatchedProductItem } from './watch-derived-item.types.js';
import { mapContinueWatchingRowToProduct, mapWatchedRowToProduct } from './watch-row-product.mapper.js';

export class WatchReadService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly watchQueryService = new WatchQueryService(),
  ) {}

  async listContinueWatchingProducts(userId: string, profileId: string, limit: number): Promise<ContinueWatchingProductItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.watchQueryService.listContinueWatching(client, profileId, limit);
      return rows
        .map((row) => mapContinueWatchingRowToProduct(row))
        .filter((item): item is ContinueWatchingProductItem => item !== null);
    });
  }

  async listWatchedProducts(userId: string, profileId: string, limit: number): Promise<WatchedProductItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.watchQueryService.listWatchHistory(client, profileId, limit);
      return rows
        .map((row) => mapWatchedRowToProduct(row))
        .filter((item): item is WatchedProductItem => item !== null);
    });
  }
}
