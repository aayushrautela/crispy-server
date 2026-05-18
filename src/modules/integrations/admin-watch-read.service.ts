import { db, type DbClient } from '../../lib/db.js';
import { decodeWatchPageCursor } from '../watch/watch-pagination.js';
import type { BaseItemDto } from '../metadata/media-item.types.js';
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

  async listContinueWatchingPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
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
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: row.last_activity_at as Date, tieBreaker: String(row.title_media_key) }), mapContinueWatchingRow);
  }

  async listWatchlistPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
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
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: row.added_at as Date, tieBreaker: String(row.media_key) }), mapListItemRow);
  }

  async assertProfileAccess(client: DbClient, params: { accountId: string; profileId: string }): Promise<void> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
  }

  async listRatingsPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
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
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: row.rated_at as Date, tieBreaker: String(row.media_key) }), mapRatingRow);
  }

  async listHistoryPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);

    const query = `WITH event_rows AS (
                     SELECT we.id,
                            CASE
                              WHEN we.media_type = 'movie' THEN COALESCE(NULLIF(we.title_media_key, ''), we.media_key)
                              WHEN COALESCE(NULLIF(we.title_media_key, ''), '') LIKE 'show:%' THEN we.title_media_key
                              WHEN we.media_key LIKE 'episode:%:%:%' OR we.media_key LIKE 'season:%:%' THEN concat('show:', split_part(we.media_key, ':', 2), ':', split_part(we.media_key, ':', 3))
                              ELSE COALESCE(NULLIF(we.title_media_key, ''), we.media_key)
                            END AS history_media_key,
                            CASE WHEN we.media_type = 'movie' THEN 'movie' ELSE 'show' END AS history_media_type,
                            we.event_type, we.occurred_at, we.source_kind, we.source_provider
                     FROM user_state.watch_events we
                     WHERE we.profile_id = $1::uuid
                       AND we.event_type IN ('playback_completed', 'marked_watched')
                   ),
                   title_ranked AS (
                     SELECT er.*,
                            ROW_NUMBER() OVER (
                              PARTITION BY er.history_media_key, date_trunc('month', er.occurred_at)
                              ORDER BY er.occurred_at DESC, er.id DESC
                            ) AS rn
                     FROM event_rows er
                   )
                   SELECT id, history_media_key AS media_key, history_media_type AS media_type, event_type, occurred_at, source_kind, source_provider
                   FROM title_ranked
                   WHERE rn = 1
                      AND ($2::timestamptz IS NULL OR occurred_at < $2::timestamptz
                           OR (occurred_at = $2::timestamptz AND id < $3::uuid))
                     ORDER BY occurred_at DESC, id DESC
                    LIMIT $4`;
    const queryParams: unknown[] = [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, params.limit + 1];

    const { rows } = await db.query(query, queryParams);
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: row.occurred_at as Date, tieBreaker: String(row.id) }), mapHistoryRow);
  }
}
