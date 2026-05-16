import { db, withDbClient } from '../../lib/db.js';
import { decodeWatchPageCursor } from '../watch/watch-pagination.js';
import type {
  ContinueWatchingProductItem,
  HistoryProductItem,
  RatingProductItem,
  WatchlistProductItem,
} from '../watch/watch-derived-item.types.js';
import type { PaginatedWatchCollection, WatchStateResponse } from '../watch/watch-read.types.js';
import { pageFromRows } from './supabase-watch-read-helpers.js';
import {
  mapSupabaseContinueWatchingRow,
  mapSupabaseHistoryRow,
  mapSupabaseListItemRow,
  mapSupabaseRatingRow,
  mapSupabaseWatchStateRow,
  type SupabaseWatchReadRow,
} from './supabase-watch-read.mapper.js';

type RecordPlaybackParams = {
  accountId: string;
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
  accountId: string;
  profileId: string;
  titleMediaKey: string;
};

type SetListItemParams = {
  accountId: string;
  profileId: string;
  listKind: 'watchlist';
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
};

type DeleteListItemParams = {
  accountId: string;
  profileId: string;
  listKind: 'watchlist';
  mediaKey: string;
};

type SetRatingParams = {
  accountId: string;
  profileId: string;
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  rating: number;
};

type DeleteRatingParams = {
  accountId: string;
  profileId: string;
  mediaKey: string;
};

type MarkWatchedParams = {
  accountId: string;
  profileId: string;
  mediaKey: string;
  titleMediaKey: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  occurredAt?: string;
};

type UnmarkWatchedParams = {
  accountId: string;
  profileId: string;
  mediaKey: string;
  titleMediaKey: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  occurredAt?: string;
};

type ListPageParams = {
  accountId: string;
  profileId: string;
  limit: number;
  cursor?: string | null;
};

type ListHistoryPageParams = ListPageParams & {
  mediaKey?: string | null;
};

type GetStateParams = {
  accountId: string;
  profileId: string;
  mediaKeys: string[];
};

export class LocalUserWatchService {
  async listContinueWatchingPage(params: ListPageParams): Promise<PaginatedWatchCollection<ContinueWatchingProductItem>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT pp.title_media_key, pp.media_type,
              pp.position_seconds, pp.duration_seconds, pp.progress_bps,
              pp.last_activity_at, pp.source_kind, pp.source_provider
       FROM user_state.playback_progress pp
       WHERE pp.profile_id = $1::uuid AND pp.dismissed_at IS NULL
         AND ($2::timestamptz IS NULL OR pp.last_activity_at < $2::timestamptz
              OR (pp.last_activity_at = $2::timestamptz AND pp.title_media_key > $3))
       ORDER BY pp.last_activity_at DESC, pp.title_media_key ASC
       LIMIT $4`,
      [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? '', limit],
    );
    return pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: String(row.last_activity_at), tieBreaker: String(row.title_media_key) }),
      (row) => mapSupabaseContinueWatchingRow(row),
    );
  }

  async listWatchlistPage(params: ListPageParams): Promise<PaginatedWatchCollection<WatchlistProductItem>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT pli.media_key, pli.media_type, pli.added_at, pli.source_kind, pli.source_provider
       FROM user_state.profile_list_items pli
       WHERE pli.profile_id = $1::uuid AND pli.list_kind = 'watchlist'
         AND ($2::timestamptz IS NULL OR pli.added_at < $2::timestamptz
              OR (pli.added_at = $2::timestamptz AND pli.media_key > $3))
       ORDER BY pli.added_at DESC, pli.media_key ASC
       LIMIT $4`,
      [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? '', limit],
    );
    return pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: String(row.added_at), tieBreaker: String(row.media_key) }),
      (row) => mapSupabaseListItemRow(row),
    );
  }

  async listRatingsPage(params: ListPageParams): Promise<PaginatedWatchCollection<RatingProductItem>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT pr.media_key, pr.media_type, pr.rating, pr.rated_at, pr.source_kind, pr.source_provider
       FROM user_state.profile_ratings pr
       WHERE pr.profile_id = $1::uuid
         AND ($2::timestamptz IS NULL OR pr.rated_at < $2::timestamptz
              OR (pr.rated_at = $2::timestamptz AND pr.media_key > $3))
       ORDER BY pr.rated_at DESC, pr.media_key ASC
       LIMIT $4`,
      [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? '', limit],
    );
    return pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: String(row.rated_at), tieBreaker: String(row.media_key) }),
      (row) => mapSupabaseRatingRow(row),
    );
  }

  async listHistoryPage(params: ListHistoryPageParams): Promise<PaginatedWatchCollection<HistoryProductItem>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    let query: string;
    const queryParams: unknown[] = [params.profileId];

    if (params.mediaKey) {
      query = `SELECT we.id, we.media_key, we.media_type, we.event_type, we.occurred_at, we.source_kind, we.source_provider
               FROM user_state.watch_events we
               WHERE we.profile_id = $1::uuid AND we.title_media_key = $2
                 AND ($3::timestamptz IS NULL OR we.occurred_at < $3::timestamptz
                      OR (we.occurred_at = $3::timestamptz AND we.id > $4::uuid))
               ORDER BY we.occurred_at DESC, we.id ASC
               LIMIT $5`;
      queryParams.push(params.mediaKey, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit);
    } else {
      query = `SELECT we.id, we.media_key, we.media_type, we.event_type, we.occurred_at, we.source_kind, we.source_provider
               FROM user_state.watch_events we
               WHERE we.profile_id = $1::uuid
                 AND ($2::timestamptz IS NULL OR we.occurred_at < $2::timestamptz
                      OR (we.occurred_at = $2::timestamptz AND we.id > $3::uuid))
               ORDER BY we.occurred_at DESC, we.id ASC
               LIMIT $4`;
      queryParams.push(cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit);
    }

    const result = await db.query(query, queryParams);
    return pageFromRows(
      result.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: String(row.occurred_at), tieBreaker: String(row.id) }),
      (row) => mapSupabaseHistoryRow(row),
    );
  }

  async getState(params: GetStateParams): Promise<WatchStateResponse> {
    const states = await this.getStates(params);
    return states[0] ?? ({
      kind: 'watch_state' as const,
      mediaItem: {
        mediaKey: params.mediaKeys[0] ?? '',
        mediaType: '',
        images: { poster: null, backdrop: null, logo: null, still: null },
        title: params.mediaKeys[0] ?? '',
        originalTitle: null, overview: null, releaseDate: null,
        genres: [], runtimeMinutes: null, status: null,
        maturityRating: null, certification: null,
        trailerUrl: null, trailerThumbnailUrl: null,
        posterColor: null, backdropColor: null,
        externalIds: {}, parent: null, showTmdbId: null,
        seasonNumber: null, episodeNumber: null,
        absoluteEpisodeNumber: null, episodeTitle: null, airDate: null,
        subtitle: null, releaseYear: null, rating: null, badges: [] as never[],
      },
      context: {
        progress: null, continueWatching: null, watched: null,
        watchlist: null, rating: null, watchedEpisodeKeys: [], playCount: 0,
      },
      presentation: null,
      progress: null, continueWatching: null, watched: null,
      watchlist: null, rating: null, watchedEpisodeKeys: [], playCount: 0,
    } as unknown as WatchStateResponse);
  }

  async getStates(params: GetStateParams): Promise<WatchStateResponse[]> {
    if (params.mediaKeys.length === 0) return [];

    return withDbClient(async (client) => {
      const mediaKeys = [...new Set(params.mediaKeys)];

    const [pbRows, liRows, rtRows, wsRows] = await Promise.all([
        client.query(
          `SELECT title_media_key, playable_media_key, media_type, position_seconds, duration_seconds,
                  progress_bps, last_activity_at, dismissed_at, source_kind, source_provider
           FROM user_state.playback_progress
           WHERE profile_id = $1::uuid AND title_media_key = ANY($2::text[])`,
          [params.profileId, mediaKeys],
        ),
        client.query(
          `SELECT media_key, media_type, list_kind, added_at, source_kind, source_provider
           FROM user_state.profile_list_items
           WHERE profile_id = $1::uuid AND list_kind = 'watchlist' AND media_key = ANY($2::text[])`,
          [params.profileId, mediaKeys],
        ),
        client.query(
          `SELECT media_key, media_type, rating, rated_at, source_kind, source_provider
           FROM user_state.profile_ratings
           WHERE profile_id = $1::uuid AND media_key = ANY($2::text[])`,
          [params.profileId, mediaKeys],
        ),
        client.query(
          `SELECT media_key, title_media_key, media_type, effective_watched, play_count, last_watched_at,
                  watched_episode_keys
           FROM user_state.media_watch_summary
           WHERE profile_id = $1::uuid AND (media_key = ANY($2::text[]) OR title_media_key = ANY($2::text[]))`,
          [params.profileId, mediaKeys],
        ),
      ]);

      const pbByKey = new Map(pbRows.rows.map((r) => [String(r.title_media_key), r]));
      const liByKey = new Map(liRows.rows.map((r) => [String(r.media_key), r]));
      const rtByKey = new Map(rtRows.rows.map((r) => [String(r.media_key), r]));
      const wsByKey = new Map(wsRows.rows.map((r) => [String(r.title_media_key), r]));

      return mediaKeys.map((mediaKey) => {
        const pb = pbByKey.get(mediaKey);
        const li = liByKey.get(mediaKey);
        const rt = rtByKey.get(mediaKey);
        const ws = wsByKey.get(mediaKey);

        const mergedRow: Record<string, unknown> = {
          media_key: mediaKey,
          media_type: li?.media_type ?? ws?.media_type ?? pb?.media_type ?? '',
          // playback_progress fields
          position_seconds: pb?.position_seconds ?? null,
          duration_seconds: pb?.duration_seconds ?? null,
          progress_bps: pb?.progress_bps ?? null,
          last_activity_at: pb?.last_activity_at ?? null,
          // continue watching fields
          continue_title_media_key: pb?.title_media_key ?? null,
          continue_position_seconds: pb?.position_seconds ?? null,
          continue_duration_seconds: pb?.duration_seconds ?? null,
          continue_progress_bps: pb?.progress_bps ?? null,
          continue_last_activity_at: pb?.last_activity_at ?? null,
          continue_dismissed_at: pb?.dismissed_at ?? null,
          // list item fields
          watchlist_added_at: li?.added_at ?? null,
          // rating fields
          rating: rt?.rating ?? null,
          rated_at: rt?.rated_at ?? null,
          // watch summary fields
          effective_watched: ws?.effective_watched ?? false,
          play_count: ws?.play_count ?? 0,
          last_watched_at: ws?.last_watched_at ?? null,
          watched_episode_keys: Array.isArray(ws?.watched_episode_keys) ? ws.watched_episode_keys : [],
        };

        return mapSupabaseWatchStateRow(mergedRow);
      });
    });
  }

  async recordPlaybackState(params: RecordPlaybackParams): Promise<void> {
    const progressBps = params.durationSeconds && params.durationSeconds > 0
      ? Math.round((params.positionSeconds ?? 0) / params.durationSeconds * 10000)
      : null;

    await withDbClient(async (client) => {
      if (params.eventKind === 'playback_completed') {
        await client.query(
          `INSERT INTO user_state.watch_events
             (account_id, profile_id, media_key, title_media_key, media_type, event_type,
              occurred_at, position_seconds, duration_seconds, progress_bps,
              source_kind, last_actor_account_id, client_event_id)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'playback_completed',
                   COALESCE($6::timestamptz, now()), $7, $8, $9,
                   'local', $1::uuid, $10)
           RETURNING id`,
          [params.accountId, params.profileId, params.mediaKey, params.titleMediaKey, params.mediaType,
           params.occurredAt ?? null, params.positionSeconds, params.durationSeconds, progressBps,
           params.clientEventId ?? null],
        );
      }

      await client.query(
        `INSERT INTO user_state.playback_progress
           (profile_id, title_media_key, playable_media_key, media_type,
            position_seconds, duration_seconds, progress_bps, last_activity_at,
            source_kind, account_id, last_actor_account_id)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, now(), 'local', $8::uuid, $8::uuid)
         ON CONFLICT (profile_id, title_media_key) DO UPDATE SET
           playable_media_key = EXCLUDED.playable_media_key,
           position_seconds = EXCLUDED.position_seconds,
           duration_seconds = EXCLUDED.duration_seconds,
           progress_bps = EXCLUDED.progress_bps,
           last_activity_at = now(),
           dismissed_at = NULL,
           updated_at = now()`,
        [params.profileId, params.titleMediaKey, params.mediaKey, params.mediaType,
         params.positionSeconds, params.durationSeconds, progressBps, params.accountId],
      );
    });
  }

  async dismissContinueWatching(params: DismissContinueWatchingParams): Promise<void> {
    await db.query(
      `UPDATE user_state.playback_progress
       SET dismissed_at = now(), updated_at = now()
       WHERE profile_id = $1::uuid AND title_media_key = $2`,
      [params.profileId, params.titleMediaKey],
    );
  }

  async setListItem(params: SetListItemParams): Promise<void> {
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';
    await db.query(
      `INSERT INTO user_state.profile_list_items
         (account_id, profile_id, list_kind, media_key, media_type, added_at, source_kind, last_actor_account_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, now(), 'local', $1::uuid)
       ON CONFLICT (profile_id, list_kind, media_key) DO UPDATE SET
         updated_at = now(), source_kind = 'local', last_actor_account_id = $1::uuid`,
      [params.accountId, params.profileId, params.listKind, params.mediaKey, canonicalType],
    );
  }

  async deleteListItem(params: DeleteListItemParams): Promise<void> {
    await db.query(
      `DELETE FROM user_state.profile_list_items
       WHERE profile_id = $1::uuid AND list_kind = $2 AND media_key = $3`,
      [params.profileId, params.listKind, params.mediaKey],
    );
  }

  async setRating(params: SetRatingParams): Promise<void> {
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';
    await db.query(
      `INSERT INTO user_state.profile_ratings
         (account_id, profile_id, media_key, media_type, rating, rated_at, source_kind, last_actor_account_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, now(), 'local', $1::uuid)
       ON CONFLICT (profile_id, media_key) DO UPDATE SET
         rating = EXCLUDED.rating, rated_at = now(),
         source_kind = 'local', last_actor_account_id = $1::uuid, updated_at = now()`,
      [params.accountId, params.profileId, params.mediaKey, canonicalType, params.rating],
    );
  }

  async deleteRating(params: DeleteRatingParams): Promise<void> {
    await db.query(
      `DELETE FROM user_state.profile_ratings
       WHERE profile_id = $1::uuid AND media_key = $2`,
      [params.profileId, params.mediaKey],
    );
  }

  async markWatched(params: MarkWatchedParams): Promise<void> {
    const occurredAt = params.occurredAt || new Date().toISOString();
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';

    await withDbClient(async (client) => {
      await client.query(
        `INSERT INTO user_state.watch_events
           (account_id, profile_id, media_key, title_media_key, media_type, event_type,
            occurred_at, source_kind, last_actor_account_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'playback_completed',
                 $6::timestamptz, 'local', $1::uuid)`,
        [params.accountId, params.profileId, params.mediaKey, params.titleMediaKey, canonicalType, occurredAt],
      );

      await client.query(
        `INSERT INTO user_state.media_watch_summary
           (profile_id, media_key, title_media_key, media_type, effective_watched, play_count,
            last_watched_at, last_activity_at, source_kind, account_id)
         VALUES ($1::uuid, $2, $3, $4, true, 1, $5::timestamptz, $5::timestamptz, 'local', $6::uuid)
         ON CONFLICT (profile_id, media_key) DO UPDATE SET
           effective_watched = true,
           play_count = media_watch_summary.play_count + 1,
           last_watched_at = $5::timestamptz,
           last_activity_at = $5::timestamptz,
           updated_at = now()`,
        [params.profileId, params.mediaKey, params.titleMediaKey, canonicalType, occurredAt, params.accountId],
      );
    });
  }

  async unmarkWatched(params: UnmarkWatchedParams): Promise<void> {
    const occurredAt = params.occurredAt || new Date().toISOString();
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';

    await withDbClient(async (client) => {
      await client.query(
        `INSERT INTO user_state.watch_events
           (account_id, profile_id, media_key, title_media_key, media_type, event_type,
            occurred_at, source_kind, last_actor_account_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'marked_unwatched',
                 $6::timestamptz, 'local', $1::uuid)`,
        [params.accountId, params.profileId, params.mediaKey, params.titleMediaKey, canonicalType, occurredAt],
      );

      await client.query(
        `UPDATE user_state.media_watch_summary
         SET effective_watched = false, last_unwatched_at = $3::timestamptz,
             last_activity_at = $3::timestamptz, updated_at = now()
         WHERE profile_id = $1::uuid AND media_key = $2`,
        [params.profileId, params.mediaKey, occurredAt],
      );
    });
  }
}

function origins(row: Record<string, unknown>): string[] {
  const sourceProvider = typeof row.source_provider === 'string' ? row.source_provider : null;
  if (sourceProvider) return [sourceProvider];
  const sourceKind = typeof row.source_kind === 'string' ? row.source_kind : null;
  return sourceKind ? [sourceKind] : [];
}
