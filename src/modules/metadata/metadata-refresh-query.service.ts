import type { DbClient } from '../../lib/db.js';
import { WatchV2EpisodicFollowQueryService, type EpisodicFollowRow } from '../watch/watch-v2-episodic-follow-query.service.js';

export class MetadataRefreshQueryService {
  constructor(private readonly episodicFollowQueryService = new WatchV2EpisodicFollowQueryService()) {}

  async listEpisodicFollow(client: DbClient, profileId: string, limit = 100): Promise<EpisodicFollowRow[]> {
    return this.episodicFollowQueryService.listEpisodicFollow(client, profileId, limit);
  }

  async getEpisodicFollowByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<EpisodicFollowRow | null> {
    return this.episodicFollowQueryService.getEpisodicFollowByMediaKey(client, profileId, mediaKey);
  }

  async getEpisodicFollowByContentId(client: DbClient, profileId: string, titleContentId: string): Promise<EpisodicFollowRow | null> {
    return this.episodicFollowQueryService.getEpisodicFollowByContentId(client, profileId, titleContentId);
  }
}
