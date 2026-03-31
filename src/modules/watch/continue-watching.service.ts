import { WatchReadService } from './watch-read.service.js';
import type { HydratedWatchItem } from './watch-read.types.js';
import type { ContinueWatchingProductItem } from './watch-derived-item.types.js';

export class ContinueWatchingService {
  constructor(private readonly watchReadService = new WatchReadService()) {}

  async list(userId: string, profileId: string, limit: number): Promise<HydratedWatchItem[]> {
    return this.watchReadService.listContinueWatching(userId, profileId, limit);
  }

  async listProducts(userId: string, profileId: string, limit: number): Promise<ContinueWatchingProductItem[]> {
    return this.watchReadService.listContinueWatchingProducts(userId, profileId, limit);
  }
}
