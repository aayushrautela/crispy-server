import { WatchReadService } from './watch-read.service.js';
import type { WatchedProductItem } from './watch-derived-item.types.js';
import type { PaginatedWatchCollection } from './watch-read.types.js';

export class WatchedQueryService {
  constructor(private readonly watchReadService = new WatchReadService()) {}

  async listProducts(userId: string, profileId: string, limit: number): Promise<WatchedProductItem[]> {
    return this.watchReadService.listWatchedProducts(userId, profileId, limit);
  }

  async listPage(
    userId: string,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PaginatedWatchCollection<WatchedProductItem>> {
    return this.watchReadService.listWatchedPage(userId, profileId, params);
  }
}
