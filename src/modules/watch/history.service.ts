import { WatchReadService } from './watch-read.service.js';
import type { HydratedWatchItem } from './watch-read.types.js';

export class WatchHistoryQueryService {
  constructor(private readonly watchReadService = new WatchReadService()) {}

  async list(userId: string, profileId: string, limit: number): Promise<HydratedWatchItem[]> {
    return this.watchReadService.listHistory(userId, profileId, limit);
  }
}
