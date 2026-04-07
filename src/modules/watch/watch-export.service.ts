import { withDbClient, type DbClient } from '../../lib/db.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { WatchQueryService } from './watch-query.service.js';
import type {
  RawContinueWatchingRow,
  RawWatchHistoryRow,
  RawWatchlistRow,
  RawRatingRow,
  RawProgressRow,
  RawEpisodicFollowRow,
} from './watch-query.service.js';

export type { RawContinueWatchingRow, RawWatchHistoryRow, RawWatchlistRow, RawRatingRow, RawProgressRow, RawEpisodicFollowRow };

export type EpisodicFollowExport = RawEpisodicFollowRow;

export type WatchCollectionBundle = {
  continueWatching: RawContinueWatchingRow[];
  watchHistoryLatest: RawWatchHistoryRow[];
  watchlist: RawWatchlistRow[];
  ratings: RawRatingRow[];
};

export class WatchExportService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly watchQueryService = new WatchQueryService(),
  ) {}

  async listContinueWatching(client: DbClient, profileId: string, limit: number): Promise<RawContinueWatchingRow[]> {
    return this.watchQueryService.listContinueWatching(client, profileId, limit);
  }

  async listWatchHistory(client: DbClient, profileId: string, limit: number): Promise<RawWatchHistoryRow[]> {
    return this.watchQueryService.listWatchHistory(client, profileId, limit);
  }

  async listWatchlist(client: DbClient, profileId: string, limit: number): Promise<RawWatchlistRow[]> {
    return this.watchQueryService.listWatchlist(client, profileId, limit);
  }

  async listRatings(client: DbClient, profileId: string, limit: number): Promise<RawRatingRow[]> {
    return this.watchQueryService.listRatings(client, profileId, limit);
  }

  async listEpisodicFollow(client: DbClient, profileId: string, limit: number): Promise<EpisodicFollowExport[]> {
    return this.watchQueryService.listEpisodicFollow(client, profileId, limit);
  }

  async getProgress(client: DbClient, profileId: string, mediaKey: string): Promise<RawProgressRow | null> {
    return this.watchQueryService.getProgress(client, profileId, mediaKey);
  }

  async getContinueWatchingByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawContinueWatchingRow | null> {
    return this.watchQueryService.getContinueWatchingByMediaKey(client, profileId, mediaKey);
  }

  async getWatchHistoryByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawWatchHistoryRow | null> {
    return this.watchQueryService.getWatchHistoryByMediaKey(client, profileId, mediaKey);
  }

  async getWatchlistByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawWatchlistRow | null> {
    return this.watchQueryService.getWatchlistByMediaKey(client, profileId, mediaKey);
  }

  async getRatingByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawRatingRow | null> {
    return this.watchQueryService.getRatingByMediaKey(client, profileId, mediaKey);
  }

  async listWatchedEpisodeKeysForShow(client: DbClient, profileId: string, seriesMediaKey: string): Promise<string[]> {
    return this.watchQueryService.listWatchedEpisodeKeysForShow(client, profileId, seriesMediaKey);
  }
}
