import type { DbClient } from '../../lib/db.js';
import { WatchV2TrackedQueryService, type TrackedTitleRow } from '../watch/watch-v2-tracked-query.service.js';

export class MetadataRefreshQueryService {
  constructor(private readonly trackedQueryService = new WatchV2TrackedQueryService()) {}

  async listTrackedTitles(client: DbClient, profileId: string, limit = 100): Promise<TrackedTitleRow[]> {
    return this.trackedQueryService.listTrackedTitles(client, profileId, limit);
  }

  async getTrackedTitleByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<TrackedTitleRow | null> {
    return this.trackedQueryService.getTrackedTitleByMediaKey(client, profileId, mediaKey);
  }
}
