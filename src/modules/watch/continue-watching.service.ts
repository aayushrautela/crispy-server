import { WatchReadService } from './watch-read.service.js';
import type { ContinueWatchingProductItem } from './watch-derived-item.types.js';

export class ContinueWatchingService {
  constructor(private readonly watchReadService = new WatchReadService()) {}

  async listProducts(userId: string, profileId: string, limit: number): Promise<ContinueWatchingProductItem[]> {
    return this.watchReadService.listContinueWatchingProducts(userId, profileId, limit);
  }
}
