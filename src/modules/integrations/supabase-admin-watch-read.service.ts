import { logger } from '../../config/logger.js';
import { HttpError } from '../../lib/errors.js';
import type { DbClient } from '../../lib/db.js';
import { getSupabaseServiceRoleClient } from '../../lib/supabase.js';
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
    const supabase = getSupabaseServiceRoleClient();
    
    let query = supabase
      .from('playback_progress')
      .select('*')
      .eq('profile_id', params.profileId)
      .is('dismissed_at', null)
      .not('last_activity_at', 'is', null);

    if (cursor) {
      query = query.or(`last_activity_at.lt.${cursor.sortValue},and(last_activity_at.eq.${cursor.sortValue},title_media_key.lt.${cursor.tieBreaker})`);
    }

    query = query.order('last_activity_at', { ascending: false }).order('title_media_key', { ascending: false }).limit(params.limit + 1);

    const { data, error } = await query;
    if (error) {
      logger.error({ error }, 'supabase admin continue watching read failed');
      throw new HttpError(502, 'Supabase admin watch read failed.');
    }

    const rows = (data ?? []) as SupabaseWatchReadRow[];
    return pageFromRows(rows, params.limit, (row) => ({ sortValue: String(row.last_activity_at), tieBreaker: String(row.title_media_key) }), mapSupabaseContinueWatchingRow);
  }

  async listWatchlistPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<WatchlistProductItem>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);
    const supabase = getSupabaseServiceRoleClient();
    
    let query = supabase
      .from('profile_list_items')
      .select('*')
      .eq('profile_id', params.profileId)
      .eq('list_kind', 'watchlist');

    if (cursor) {
      query = query.or(`added_at.lt.${cursor.sortValue},and(added_at.eq.${cursor.sortValue},media_key.lt.${cursor.tieBreaker})`);
    }

    query = query.order('added_at', { ascending: false }).order('media_key', { ascending: false }).limit(params.limit + 1);

    const { data, error } = await query;
    if (error) {
      logger.error({ error }, 'supabase admin watchlist read failed');
      throw new HttpError(502, 'Supabase admin watch read failed.');
    }

    const rows = (data ?? []) as SupabaseWatchReadRow[];
    return pageFromRows(rows, params.limit, (row) => ({ sortValue: String(row.added_at), tieBreaker: String(row.media_key) }), mapSupabaseListItemRow);
  }

  async assertProfileAccess(client: DbClient, params: { accountId: string; profileId: string }): Promise<void> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
  }

  async listRatingsPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<RatingProductItem>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);
    const supabase = getSupabaseServiceRoleClient();
    
    let query = supabase
      .from('profile_ratings')
      .select('*')
      .eq('profile_id', params.profileId);

    if (cursor) {
      query = query.or(`rated_at.lt.${cursor.sortValue},and(rated_at.eq.${cursor.sortValue},media_key.lt.${cursor.tieBreaker})`);
    }

    query = query.order('rated_at', { ascending: false }).order('media_key', { ascending: false }).limit(params.limit + 1);

    const { data, error } = await query;
    if (error) {
      logger.error({ error }, 'supabase admin ratings read failed');
      throw new HttpError(502, 'Supabase admin watch read failed.');
    }

    const rows = (data ?? []) as SupabaseWatchReadRow[];
    return pageFromRows(rows, params.limit, (row) => ({ sortValue: String(row.rated_at), tieBreaker: String(row.media_key) }), mapSupabaseRatingRow);
  }

  async listHistoryPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<HistoryProductItem>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);
    const supabase = getSupabaseServiceRoleClient();
    
    let query = supabase
      .from('watch_events')
      .select('*')
      .eq('profile_id', params.profileId)
      .in('event_type', ['playback_completed', 'marked_watched']);

    if (cursor) {
      query = query.or(`occurred_at.lt.${cursor.sortValue},and(occurred_at.eq.${cursor.sortValue},id.lt.${cursor.tieBreaker})`);
    }

    query = query.order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(params.limit + 1);

    const { data, error } = await query;
    if (error) {
      logger.error({ error }, 'supabase admin history read failed');
      throw new HttpError(502, 'Supabase admin watch read failed.');
    }

    const rows = (data ?? []) as SupabaseWatchReadRow[];
    return pageFromRows(rows, params.limit, (row) => ({ sortValue: String(row.occurred_at), tieBreaker: String(row.id) }), mapSupabaseHistoryRow);
  }

}
