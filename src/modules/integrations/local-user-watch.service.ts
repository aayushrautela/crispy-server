import { db, withDbClient } from '../../lib/db.js';
import { decodeWatchPageCursor } from '../watch/watch-pagination.js';
import type { BaseItemDto } from '../metadata/media-item.types.js';
import type { PaginatedWatchCollection } from '../watch/watch-read.types.js';
import { pageFromRows } from './watch-read-helpers.js';
import {
  mapContinueWatchingRow,
  mapHistoryRow,
  mapListItemRow,
  mapRatingRow,
  mapWatchStateRow,
  type WatchReadRow,
} from './watch-read.mapper.js';

type RecordPlaybackParams = {
  accountId: string;
  profileId: string;
  itemId: string;
  titleItemId: string;
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
  titleItemId: string;
};

type SetListItemParams = {
  accountId: string;
  profileId: string;
  listKind: 'watchlist';
  itemId: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
};

type DeleteListItemParams = {
  accountId: string;
  profileId: string;
  listKind: 'watchlist';
  itemId: string;
};

type SetRatingParams = {
  accountId: string;
  profileId: string;
  itemId: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  rating: number;
};

type DeleteRatingParams = {
  accountId: string;
  profileId: string;
  itemId: string;
};

type MarkWatchedParams = {
  accountId: string;
  profileId: string;
  itemId: string;
  titleItemId: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  occurredAt?: string;
};

type UnmarkWatchedParams = {
  accountId: string;
  profileId: string;
  itemId: string;
  titleItemId: string;
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
  itemId?: string | null;
};

type GetStateParams = {
  accountId: string;
  profileId: string;
  itemIds: string[];
};

export class LocalUserWatchService {
  async listContinueWatchingPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT pp.title_item_id, pp.playable_item_id, pp.media_type,
              pp.position_seconds, pp.duration_seconds, pp.progress_bps,
              pp.last_activity_at, pp.source_kind, pp.source_provider
       FROM user_state.playback_progress pp
       WHERE pp.profile_id = $1::uuid AND pp.dismissed_at IS NULL
         AND ($2::timestamptz IS NULL OR pp.last_activity_at < $2::timestamptz
              OR (pp.last_activity_at = $2::timestamptz AND pp.title_item_id > $3::uuid))
       ORDER BY pp.last_activity_at DESC, pp.title_item_id ASC
       LIMIT $4`,
      [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit],
    );
    return pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: row.last_activity_at as Date, tieBreaker: String(row.title_item_id) }),
      (row) => mapContinueWatchingRow(row),
    );
  }

  async listWatchlistPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT pli.item_id, pli.media_type, pli.added_at, pli.source_kind, pli.source_provider
       FROM user_state.profile_list_items pli
       WHERE pli.profile_id = $1::uuid AND pli.list_kind = 'watchlist'
         AND ($2::timestamptz IS NULL OR pli.added_at < $2::timestamptz
              OR (pli.added_at = $2::timestamptz AND pli.item_id > $3::uuid))
       ORDER BY pli.added_at DESC, pli.item_id ASC
       LIMIT $4`,
      [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit],
    );
    return pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: row.added_at as Date, tieBreaker: String(row.item_id) }),
      (row) => mapListItemRow(row),
    );
  }

  async listRatingsPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT pr.item_id, pr.media_type, pr.rating, pr.rated_at, pr.source_kind, pr.source_provider
       FROM user_state.profile_ratings pr
       WHERE pr.profile_id = $1::uuid
         AND ($2::timestamptz IS NULL OR pr.rated_at < $2::timestamptz
              OR (pr.rated_at = $2::timestamptz AND pr.item_id > $3::uuid))
       ORDER BY pr.rated_at DESC, pr.item_id ASC
       LIMIT $4`,
      [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit],
    );
    return pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: row.rated_at as Date, tieBreaker: String(row.item_id) }),
      (row) => mapRatingRow(row),
    );
  }

  async listHistoryPage(params: ListHistoryPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    let query: string;
    const queryParams: unknown[] = [params.profileId];

    if (params.itemId) {
      query = `SELECT we.id, we.item_id, we.title_item_id, we.media_type, we.event_type, we.occurred_at, we.source_kind, we.source_provider
               FROM user_state.watch_events we
               WHERE we.profile_id = $1::uuid
                 AND we.event_type IN ('playback_completed', 'marked_watched')
                 AND we.title_item_id = $2::uuid
                 AND ($3::timestamptz IS NULL OR we.occurred_at < $3::timestamptz
                      OR (we.occurred_at = $3::timestamptz AND we.id < $4::uuid))
               ORDER BY we.occurred_at DESC, we.id DESC
               LIMIT $5`;
      queryParams.push(params.itemId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit);
    } else {
      query = `WITH event_rows AS (
                 SELECT we.id,
                        we.title_item_id AS history_item_id,
                        CASE WHEN we.media_type = 'movie' THEN 'movie' ELSE 'show' END AS history_media_type,
                        we.event_type, we.occurred_at, we.source_kind, we.source_provider
                 FROM user_state.watch_events we
                 WHERE we.profile_id = $1::uuid
                   AND we.event_type IN ('playback_completed', 'marked_watched')
               ),
               title_ranked AS (
                 SELECT er.*,
                        ROW_NUMBER() OVER (
                          PARTITION BY er.history_item_id, date_trunc('month', er.occurred_at)
                          ORDER BY er.occurred_at DESC, er.id DESC
                        ) AS rn
                 FROM event_rows er
               )
               SELECT id, history_item_id AS item_id, history_media_type AS media_type, event_type, occurred_at, source_kind, source_provider
               FROM title_ranked
               WHERE rn = 1
                  AND ($2::timestamptz IS NULL OR occurred_at < $2::timestamptz
                       OR (occurred_at = $2::timestamptz AND id < $3::uuid))
                ORDER BY occurred_at DESC, id DESC
               LIMIT $4`;
      queryParams.push(cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit);
    }

    const result = await db.query(query, queryParams);
    return pageFromRows(
      result.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: row.occurred_at as Date, tieBreaker: String(row.id) }),
      (row) => mapHistoryRow(row),
    );
  }

  async getState(params: GetStateParams): Promise<BaseItemDto> {
    const states = await this.getStates(params);
    return states[0] ?? {
      Id: params.itemIds[0] ?? '',
      Type: 'Unknown' as const,
      Name: params.itemIds[0] ?? '',
      OriginalTitle: null,
      Overview: null,
      Taglines: [],
      ProductionYear: null,
      PremiereDate: null,
      CommunityRating: null,
      OfficialRating: null,
      Certification: null,
      Genres: [],
      RunTimeTicks: null,
      Status: null,
      ProviderIds: { Tmdb: null, Imdb: null, Tvdb: null },
      ImageTags: {
        Primary: null,
        Backdrop: [],
        Logo: null,
        Thumb: null,
        Screenshot: [],
      },
      ParentImageTags: null,
      SeriesId: null,
      SeriesName: null,
      SeasonId: null,
      SeasonName: null,
      ParentIndexNumber: null,
      IndexNumber: null,
      AbsoluteIndexNumber: null,
      EpisodeTitle: null,
      AirDate: null,
      RemoteTrailers: [],
      PosterColor: null,
      BackdropColor: null,
      UserData: null,
    };
  }

  async getStates(params: GetStateParams): Promise<BaseItemDto[]> {
    if (params.itemIds.length === 0) return [];

    const itemIds = [...new Set(params.itemIds)];

    return withDbClient(async (client) => {
      const result = await client.query(
        `WITH requested AS (
           SELECT unnest($2::uuid[]) AS item_id
         )
         SELECT
           req.item_id,
           ws.media_type,
           pb.position_seconds,
           pb.duration_seconds,
           pb.progress_bps,
           pb.last_activity_at,
           pb.title_item_id               AS continue_title_item_id,
           pb.position_seconds               AS continue_position_seconds,
           pb.duration_seconds               AS continue_duration_seconds,
           pb.progress_bps                   AS continue_progress_bps,
           pb.last_activity_at               AS continue_last_activity_at,
           pb.dismissed_at                   AS continue_dismissed_at,
           li.added_at                       AS watchlist_added_at,
           rt.rating,
           rt.rated_at,
           ws.effective_watched,
           ws.play_count,
           ws.last_watched_at,
           COALESCE(we.watched_episode_keys, ARRAY[]::uuid[]) AS watched_episode_keys
         FROM requested req
         LEFT JOIN user_state.media_watch_summary ws
           ON ws.profile_id = $1::uuid AND ws.item_id = req.item_id
         LEFT JOIN user_state.playback_progress pb
           ON pb.profile_id = $1::uuid AND pb.title_item_id = req.item_id AND pb.dismissed_at IS NULL
         LEFT JOIN user_state.profile_list_items li
           ON li.profile_id = $1::uuid AND li.list_kind = 'watchlist' AND li.item_id = req.item_id
         LEFT JOIN user_state.profile_ratings rt
           ON rt.profile_id = $1::uuid AND rt.item_id = req.item_id
         LEFT JOIN LATERAL (
           SELECT array_agg(s.item_id ORDER BY s.item_id) AS watched_episode_keys
           FROM user_state.media_watch_summary s
           WHERE s.profile_id = $1::uuid
             AND s.title_item_id = req.item_id
             AND s.media_type = 'episode'
             AND s.effective_watched = true
         ) we ON true`,
        [params.profileId, itemIds],
      );

      return result.rows.map((row) => mapWatchStateRow(row as Record<string, unknown>));
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
             (account_id, profile_id, item_id, title_item_id, media_type, event_type,
              occurred_at, position_seconds, duration_seconds, progress_bps,
              source_kind, last_actor_account_id, client_event_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'playback_completed',
                   COALESCE($6::timestamptz, now()), $7, $8, $9,
                   'local', $1::uuid, $10)
           RETURNING id`,
          [params.accountId, params.profileId, params.itemId, params.titleItemId, params.mediaType,
           params.occurredAt ?? null, params.positionSeconds, params.durationSeconds, progressBps,
           params.clientEventId ?? null],
        );

        await client.query(
          `INSERT INTO user_state.media_watch_summary
             (profile_id, item_id, title_item_id, media_type, effective_watched, play_count,
              last_watched_at, last_activity_at, source_kind, account_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, true, 1, now(), now(), 'local', $5::uuid)
           ON CONFLICT (profile_id, item_id) DO UPDATE SET
             effective_watched = true,
             play_count = media_watch_summary.play_count + 1,
             last_watched_at = now(),
             last_activity_at = now(),
             updated_at = now()`,
          [params.profileId, params.itemId, params.titleItemId, params.mediaType, params.accountId],
        );

        await client.query(
          `DELETE FROM user_state.playback_progress
           WHERE profile_id = $1::uuid AND title_item_id = $2::uuid`,
          [params.profileId, params.titleItemId],
        );
      } else {
        await client.query(
          `INSERT INTO user_state.playback_progress
             (profile_id, title_item_id, playable_item_id, media_type,
              position_seconds, duration_seconds, progress_bps, last_activity_at,
              source_kind, account_id, last_actor_account_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, now(), 'local', $8::uuid, $8::uuid)
           ON CONFLICT (profile_id, title_item_id) DO UPDATE SET
             playable_item_id = EXCLUDED.playable_item_id,
             position_seconds = EXCLUDED.position_seconds,
             duration_seconds = EXCLUDED.duration_seconds,
             progress_bps = EXCLUDED.progress_bps,
             last_activity_at = now(),
             dismissed_at = NULL,
             updated_at = now()`,
          [params.profileId, params.titleItemId, params.itemId, params.mediaType,
           params.positionSeconds, params.durationSeconds, progressBps, params.accountId],
        );
      }
    });
  }

  async dismissContinueWatching(params: DismissContinueWatchingParams): Promise<void> {
    await db.query(
      `UPDATE user_state.playback_progress
       SET dismissed_at = now(), updated_at = now()
       WHERE profile_id = $1::uuid AND title_item_id = $2::uuid`,
      [params.profileId, params.titleItemId],
    );
  }

  async setListItem(params: SetListItemParams): Promise<void> {
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';
    await db.query(
      `INSERT INTO user_state.profile_list_items
         (account_id, profile_id, list_kind, item_id, media_type, added_at, source_kind, last_actor_account_id)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, now(), 'local', $1::uuid)
       ON CONFLICT (profile_id, list_kind, item_id) DO UPDATE SET
         updated_at = now(), source_kind = 'local', last_actor_account_id = $1::uuid`,
      [params.accountId, params.profileId, params.listKind, params.itemId, canonicalType],
    );
  }

  async deleteListItem(params: DeleteListItemParams): Promise<void> {
    await db.query(
      `DELETE FROM user_state.profile_list_items
       WHERE profile_id = $1::uuid AND list_kind = $2 AND item_id = $3::uuid`,
      [params.profileId, params.listKind, params.itemId],
    );
  }

  async setRating(params: SetRatingParams): Promise<void> {
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';
    await db.query(
      `INSERT INTO user_state.profile_ratings
         (account_id, profile_id, item_id, media_type, rating, rated_at, source_kind, last_actor_account_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, now(), 'local', $1::uuid)
       ON CONFLICT (profile_id, item_id) DO UPDATE SET
         rating = EXCLUDED.rating, rated_at = now(),
         source_kind = 'local', last_actor_account_id = $1::uuid, updated_at = now()`,
      [params.accountId, params.profileId, params.itemId, canonicalType, params.rating],
    );
  }

  async deleteRating(params: DeleteRatingParams): Promise<void> {
    await db.query(
      `DELETE FROM user_state.profile_ratings
       WHERE profile_id = $1::uuid AND item_id = $2::uuid`,
      [params.profileId, params.itemId],
    );
  }

  async markWatched(params: MarkWatchedParams): Promise<void> {
    const occurredAt = params.occurredAt || new Date().toISOString();
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';

    await withDbClient(async (client) => {
      await client.query(
        `INSERT INTO user_state.watch_events
           (account_id, profile_id, item_id, title_item_id, media_type, event_type,
            occurred_at, source_kind, last_actor_account_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'marked_watched',
                 $6::timestamptz, 'local', $1::uuid)`,
        [params.accountId, params.profileId, params.itemId, params.titleItemId, canonicalType, occurredAt],
      );

      await client.query(
        `INSERT INTO user_state.media_watch_summary
           (profile_id, item_id, title_item_id, media_type, effective_watched, play_count,
            last_watched_at, last_activity_at, source_kind, account_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, true, 1, $5::timestamptz, $5::timestamptz, 'local', $6::uuid)
         ON CONFLICT (profile_id, item_id) DO UPDATE SET
           effective_watched = true,
           play_count = media_watch_summary.play_count + 1,
           last_watched_at = $5::timestamptz,
           last_activity_at = $5::timestamptz,
           updated_at = now()`,
        [params.profileId, params.itemId, params.titleItemId, canonicalType, occurredAt, params.accountId],
      );

      await client.query(
        `DELETE FROM user_state.playback_progress
         WHERE profile_id = $1::uuid AND title_item_id = $2::uuid`,
        [params.profileId, params.titleItemId],
      );
    });
  }

  async unmarkWatched(params: UnmarkWatchedParams): Promise<void> {
    const occurredAt = params.occurredAt || new Date().toISOString();
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';

    await withDbClient(async (client) => {
      await client.query(
        `INSERT INTO user_state.watch_events
           (account_id, profile_id, item_id, title_item_id, media_type, event_type,
            occurred_at, source_kind, last_actor_account_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'marked_unwatched',
                 $6::timestamptz, 'local', $1::uuid)`,
        [params.accountId, params.profileId, params.itemId, params.titleItemId, canonicalType, occurredAt],
      );

      await client.query(
        `UPDATE user_state.media_watch_summary
         SET effective_watched = false, last_unwatched_at = $3::timestamptz,
             last_activity_at = $3::timestamptz, updated_at = now()
         WHERE profile_id = $1::uuid AND item_id = $2::uuid`,
        [params.profileId, params.itemId, occurredAt],
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
