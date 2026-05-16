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
  mapSupabaseContinueWatchingRow,
  mapSupabaseHistoryRow,
  mapSupabaseListItemRow,
  mapSupabaseRatingRow,
  type SupabaseWatchReadRow,
} from './supabase-watch-read.mapper.js';
import { pageFromRows } from './supabase-watch-read-helpers.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
type ListPageParams = {
  accountId: string;
  profileId: string;
  limit: number;
  cursor?: string | null;
};

export class SupabaseAdminWatchReadService {
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
    return pageFromRows(rows as SupabaseWatchReadRow[], params.limit, (row) => ({ sortValue: String(row.last_activity_at), tieBreaker: String(row.title_media_key) }), mapSupabaseContinueWatchingRow);
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
    return pageFromRows(rows as SupabaseWatchReadRow[], params.limit, (row) => ({ sortValue: String(row.added_at), tieBreaker: String(row.media_key) }), mapSupabaseListItemRow);
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
    return pageFromRows(rows as SupabaseWatchReadRow[], params.limit, (row) => ({ sortValue: String(row.rated_at), tieBreaker: String(row.media_key) }), mapSupabaseRatingRow);
  }

  async listHistoryPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<HistoryProductItem>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);

    let query = `SELECT * FROM user_state.watch_events WHERE profile_id = $1::uuid AND event_type IN ('playback_completed', 'marked_watched')`;
    const queryParams: unknown[] = [params.profileId];
    let paramIdx = 2;

    if (cursor) {
      query += ` AND (occurred_at < $${paramIdx} OR (occurred_at = $${paramIdx} AND id::text < $${paramIdx + 1}))`;
      queryParams.push(cursor.sortValue, cursor.tieBreaker);
      paramIdx += 2;
    }

    query += ` ORDER BY occurred_at DESC, id DESC LIMIT $${paramIdx}`;
    queryParams.push(params.limit + 1);

    const { rows } = await db.query(query, queryParams);
    return pageFromRows(rows as SupabaseWatchReadRow[], params.limit, (row) => ({ sortValue: String(row.occurred_at), tieBreaker: String(row.id) }), mapSupabaseHistoryRow);
  }

}
