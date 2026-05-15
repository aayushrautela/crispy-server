import { logger } from '../../config/logger.js';
import { HttpError } from '../../lib/errors.js';
import { createSupabaseUserClient } from '../../lib/supabase.js';
import { decodeWatchPageCursor } from '../watch/watch-pagination.js';
import type {
  ContinueWatchingProductItem,
  HistoryProductItem,
  RatingProductItem,
  WatchlistProductItem,
} from '../watch/watch-derived-item.types.js';
import type { PaginatedWatchCollection, WatchStateResponse } from '../watch/watch-read.types.js';
import {
  mapSupabaseContinueWatchingRow,
  mapSupabaseHistoryRow,
  mapSupabaseListItemRow,
  mapSupabaseRatingRow,
  mapSupabaseWatchStateRow,
  type SupabaseWatchReadRow,
} from './supabase-watch-read.mapper.js';
import { pageFromRows } from './supabase-watch-read-helpers.js';

type RecordPlaybackParams = {
  accessToken: string;
  profileId: string;
  mediaKey: string;
  titleMediaKey: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  positionSeconds: number | null;
  durationSeconds: number | null;
  eventKind: 'playback_progress' | 'playback_completed';
  occurredAt?: string | null;
  clientEventId?: string | null;
};

type DismissContinueWatchingParams = {
  accessToken: string;
  profileId: string;
  titleMediaKey: string;
};

type SetListItemParams = {
  accessToken: string;
  profileId: string;
  listKind: 'watchlist';
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
};

type DeleteListItemParams = {
  accessToken: string;
  profileId: string;
  listKind: 'watchlist';
  mediaKey: string;
};

type SetRatingParams = {
  accessToken: string;
  profileId: string;
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  rating: number;
};

type DeleteRatingParams = {
  accessToken: string;
  profileId: string;
  mediaKey: string;
};

type MarkWatchedParams = {
  accessToken: string;
  profileId: string;
  mediaKey: string;
  titleMediaKey: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  occurredAt?: string;
};

type UnmarkWatchedParams = {
  accessToken: string;
  profileId: string;
  mediaKey: string;
  titleMediaKey: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  occurredAt?: string;
};

type ListPageParams = {
  accessToken: string;
  profileId: string;
  limit: number;
  cursor?: string | null;
};

type ListHistoryPageParams = ListPageParams & {
  mediaKey?: string | null;
};

type GetStateParams = {
  accessToken: string;
  profileId: string;
  mediaKeys: string[];
};

export class SupabaseUserWatchService {
  async listContinueWatchingPage(params: ListPageParams): Promise<PaginatedWatchCollection<ContinueWatchingProductItem>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const rows = await this.rpcRows(params.accessToken, 'list_continue_watching_page', {
      p_profile_id: params.profileId,
      p_limit: params.limit,
      p_cursor_last_activity_at: cursor?.sortValue ?? null,
      p_cursor_title_media_key: cursor?.tieBreaker ?? null,
    });
    return pageFromRows(rows, params.limit, (row) => ({ sortValue: String(row.last_activity_at), tieBreaker: String(row.title_media_key) }), mapSupabaseContinueWatchingRow);
  }

  async listWatchlistPage(params: ListPageParams): Promise<PaginatedWatchCollection<WatchlistProductItem>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const rows = await this.rpcRows(params.accessToken, 'list_profile_list_items_page', {
      p_profile_id: params.profileId,
      p_list_kind: 'watchlist',
      p_limit: params.limit,
      p_cursor_added_at: cursor?.sortValue ?? null,
      p_cursor_media_key: cursor?.tieBreaker ?? null,
    });
    return pageFromRows(rows, params.limit, (row) => ({ sortValue: String(row.added_at), tieBreaker: String(row.media_key) }), mapSupabaseListItemRow);
  }

  async listRatingsPage(params: ListPageParams): Promise<PaginatedWatchCollection<RatingProductItem>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const rows = await this.rpcRows(params.accessToken, 'list_profile_ratings_page', {
      p_profile_id: params.profileId,
      p_limit: params.limit,
      p_cursor_rated_at: cursor?.sortValue ?? null,
      p_cursor_media_key: cursor?.tieBreaker ?? null,
    });
    return pageFromRows(rows, params.limit, (row) => ({ sortValue: String(row.rated_at), tieBreaker: String(row.media_key) }), mapSupabaseRatingRow);
  }

  async listHistoryPage(params: ListHistoryPageParams): Promise<PaginatedWatchCollection<HistoryProductItem>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const rpcName = params.mediaKey ? 'list_media_watch_history_page' : 'list_watch_history_page';
    const rows = await this.rpcRows(params.accessToken, rpcName, {
      p_profile_id: params.profileId,
      ...(params.mediaKey ? { p_media_key: params.mediaKey } : {}),
      p_limit: params.limit,
      p_cursor_occurred_at: cursor?.sortValue ?? null,
      p_cursor_id: cursor?.tieBreaker ?? null,
    });
    return pageFromRows(rows, params.limit, (row) => ({ sortValue: String(row.occurred_at), tieBreaker: String(row.id) }), mapSupabaseHistoryRow);
  }

  async getState(params: GetStateParams): Promise<WatchStateResponse> {
    return (await this.getStates(params))[0] ?? mapSupabaseWatchStateRow({ media_key: params.mediaKeys[0] ?? '' });
  }

  async getStates(params: GetStateParams): Promise<WatchStateResponse[]> {
    if (params.mediaKeys.length === 0) {
      return [];
    }

    const rows = await this.rpcRows(params.accessToken, 'get_profile_watch_state', {
      p_profile_id: params.profileId,
      p_media_keys: params.mediaKeys,
    });
    const byKey = new Map(rows.map((row) => [String(row.media_key), row]));
    return params.mediaKeys.map((mediaKey) => mapSupabaseWatchStateRow(byKey.get(mediaKey) ?? { media_key: mediaKey }));
  }

  private async rpcRows(accessToken: string, rpcName: string, args: Record<string, unknown>): Promise<SupabaseWatchReadRow[]> {
    const client = createSupabaseUserClient(accessToken);
    const { data, error } = await client.rpc(rpcName, args);
    if (error) {
      logger.error({ error, rpcName }, 'supabase watch read failed');
      throw new HttpError(502, 'Supabase watch read failed.');
    }
    return Array.isArray(data) ? data as SupabaseWatchReadRow[] : [];
  }

  async recordPlaybackState(params: RecordPlaybackParams): Promise<void> {
    const progressBps = params.durationSeconds && params.durationSeconds > 0
      ? Math.round((params.positionSeconds ?? 0) / params.durationSeconds * 10000)
      : null;

    await this.rpcMutation(params.accessToken, 'record_playback_state', {
      p_profile_id: params.profileId,
      p_media_key: params.mediaKey,
      p_title_media_key: params.titleMediaKey,
      p_media_type: params.mediaType,
      p_position_seconds: params.positionSeconds,
      p_duration_seconds: params.durationSeconds,
      p_progress_bps: progressBps,
      p_event_kind: params.eventKind,
      p_occurred_at: params.occurredAt ?? null,
      p_client_event_id: params.clientEventId ?? null,
    });
  }

  async dismissContinueWatching(params: DismissContinueWatchingParams): Promise<void> {
    await this.rpcMutation(params.accessToken, 'dismiss_continue_watching', {
      p_profile_id: params.profileId,
      p_title_media_key: params.titleMediaKey,
    });
  }

  async setListItem(params: SetListItemParams): Promise<void> {
    await this.rpcMutation(params.accessToken, 'set_profile_list_item', {
      p_profile_id: params.profileId,
      p_list_kind: params.listKind,
      p_media_key: params.mediaKey,
      p_media_type: params.mediaType,
    });
  }

  async deleteListItem(params: DeleteListItemParams): Promise<void> {
    await this.rpcMutation(params.accessToken, 'delete_profile_list_item', {
      p_profile_id: params.profileId,
      p_list_kind: params.listKind,
      p_media_key: params.mediaKey,
    });
  }

  async setRating(params: SetRatingParams): Promise<void> {
    await this.rpcMutation(params.accessToken, 'set_profile_rating', {
      p_profile_id: params.profileId,
      p_media_key: params.mediaKey,
      p_media_type: params.mediaType,
      p_rating: params.rating,
    });
  }

  async deleteRating(params: DeleteRatingParams): Promise<void> {
    await this.rpcMutation(params.accessToken, 'delete_profile_rating', {
      p_profile_id: params.profileId,
      p_media_key: params.mediaKey,
    });
  }

  async markWatched(params: MarkWatchedParams): Promise<void> {
    await this.rpcMutation(params.accessToken, 'set_profile_watched_state', {
      p_profile_id: params.profileId,
      p_media_key: params.mediaKey,
      p_title_media_key: params.titleMediaKey,
      p_media_type: params.mediaType,
      p_watch_state: 'watched',
      p_occurred_at: params.occurredAt ?? null,
    });
  }

  async unmarkWatched(params: UnmarkWatchedParams): Promise<void> {
    await this.rpcMutation(params.accessToken, 'set_profile_watched_state', {
      p_profile_id: params.profileId,
      p_media_key: params.mediaKey,
      p_title_media_key: params.titleMediaKey,
      p_media_type: params.mediaType,
      p_watch_state: 'unwatched',
      p_occurred_at: params.occurredAt ?? null,
    });
  }

  private async rpcMutation(accessToken: string, rpcName: string, args: Record<string, unknown>): Promise<void> {
    const client = createSupabaseUserClient(accessToken);
    const { error } = await client.rpc(rpcName, args);
    if (error) {
      logger.error({ error, rpcName }, 'supabase watch write failed');
      throw new HttpError(502, 'Supabase watch write failed.');
    }
  }
}
