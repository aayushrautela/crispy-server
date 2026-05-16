import { logger } from '../../config/logger.js';
import { HttpError } from '../../lib/errors.js';
import { db, type DbClient } from '../../lib/db.js';
import { decodeWatchPageCursor } from '../watch/watch-pagination.js';
import type {
  ContinueWatchingProductItem,
  HistoryProductItem,
  RatingProductItem,
  WatchlistProductItem,
} from '../watch/watch-derived-item.types.js';
import type { PaginatedWatchCollection } from '../watch/watch-read.types.js';
import {
  mapContinueWatchingRow,
  mapHistoryRow,
  mapListItemRow,
  mapRatingRow,
  type WatchReadRow,
} from './watch-read.mapper.js';
import { pageFromRows } from './watch-read-helpers.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';

type ListPageParams = {
  accountId: string;
  profileId: string;
  limit: number;
  cursor?: string | null;
};

export class AdminWatchReadService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
  ) {}

  async listContinueWatchingPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<ContinueWatchingProductItem>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);

    let query = `SELECT * FROM user_state.playback_progress WHERE profile_id = $1::uuid AND dismissed_at IS NULL`;
    const queryParams: unknown[] = [params.profileId];
    let paramIdx = 2;

    if (cursor) {
      query += ` AND (last_activity_at < $${paramIdx} OR (last_activity_at = $${paramIdx} AND title_media_key < $${paramIdx + 1}))`;
      queryParams.push(cursor.sortValue, cursor.tieBreaker);
      paramIdx += 2;
    }

    query += ` ORDER BY last_activity_at DESC, title_media_key DESC LIMIT $${paramIdx}`;
    queryParams.push(params.limit + 1);

    const { rows } = await db.query(query, queryParams);
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: String(row.last_activity_at), tieBreaker: String(row.title_media_key) }), mapContinueWatchingRow);
  }

  async listWatchlistPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<WatchlistProductItem>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);

    let query = `SELECT * FROM user_state.profile_list_items WHERE profile_id = $1::uuid AND list_kind = 'watchlist'`;
    const queryParams: unknown[] = [params.profileId];
    let paramIdx = 2;

    if (cursor) {
      query += ` AND (added_at < $${paramIdx} OR (added_at = $${paramIdx} AND media_key < $${paramIdx + 1}))`;
      queryParams.push(cursor.sortValue, cursor.tieBreaker);
      paramIdx += 2;
    }

    query += ` ORDER BY added_at DESC, media_key DESC LIMIT $${paramIdx}`;
    queryParams.push(params.limit + 1);

    const { rows } = await db.query(query, queryParams);
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: String(row.added_at), tieBreaker: String(row.media_key) }), mapListItemRow);
  }

  async assertProfileAccess(client: DbClient, params: { accountId: string; profileId: string }): Promise<void> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
  }

  async listRatingsPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<RatingProductItem>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);

    let query = `SELECT * FROM user_state.profile_ratings WHERE profile_id = $1::uuid`;
    const queryParams: unknown[] = [params.profileId];
    let paramIdx = 2;

    if (cursor) {
      query += ` AND (rated_at < $${paramIdx} OR (rated_at = $${paramIdx} AND media_key < $${paramIdx + 1}))`;
      queryParams.push(cursor.sortValue, cursor.tieBreaker);
      paramIdx += 2;
    }

    query += ` ORDER BY rated_at DESC, media_key DESC LIMIT $${paramIdx}`;
    queryParams.push(params.limit + 1);

    const { rows } = await db.query(query, queryParams);
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: String(row.rated_at), tieBreaker: String(row.media_key) }), mapRatingRow);
  }

  async listHistoryPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<HistoryProductItem>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);

    const query = `WITH title_ranked AS (
                     SELECT we.id, we.media_key, we.media_type, we.event_type, we.occurred_at,
                            we.source_kind, we.source_provider,
                            ROW_NUMBER() OVER (
                              PARTITION BY COALESCE(NULLIF(we.title_media_key, ''), we.media_key)
                              ORDER BY we.occurred_at DESC, we.id DESC
                            ) AS rn
                     FROM user_state.watch_events we
                     WHERE we.profile_id = $1::uuid
                       AND we.event_type IN ('playback_completed', 'marked_watched')
                   )
                   SELECT id, media_key, media_type, event_type, occurred_at, source_kind, source_provider
                   FROM title_ranked
                   WHERE rn = 1
                     AND ($2::timestamptz IS NULL OR occurred_at < $2::timestamptz
                          OR (occurred_at = $2::timestamptz AND id > $3::uuid))
                   ORDER BY occurred_at DESC, id ASC
                   LIMIT $4`;
    const queryParams: unknown[] = [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, params.limit + 1];

    const { rows } = await db.query(query, queryParams);
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: String(row.occurred_at), tieBreaker: String(row.id) }), mapHistoryRow);
  }
}
