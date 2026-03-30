import { WatchReadService } from './watch-read.service.js';
import type { HydratedWatchItem } from './watch-read.types.js';

export class WatchedQueryService {
  constructor(private readonly watchReadService = new WatchReadService()) {}

  async list(userId: string, profileId: string, limit: number): Promise<HydratedWatchItem[]> {
    return this.watchReadService.listWatched(userId, profileId, limit);
  }
}
