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

    let query = `SELECT pp.title_item_id, pp.playable_item_id, pp.media_type,
                        pp.position_seconds, pp.duration_seconds, pp.progress_bps,
                        pp.last_activity_at, pp.source_kind, pp.source_provider,
                        tmdb_ref.external_id AS title_provider_id,
                        imdb_ref.external_id AS imdb_id,
                        tvdb_ref.external_id AS tvdb_id
                 FROM user_state.playback_progress pp
                 LEFT JOIN content_provider_refs tmdb_ref
                   ON tmdb_ref.content_id = pp.title_item_id
                  AND tmdb_ref.provider = 'tmdb'
                  AND tmdb_ref.entity_type = CASE WHEN pp.media_type = 'movie' THEN 'movie' ELSE 'show' END
                 LEFT JOIN content_provider_refs imdb_ref
                   ON imdb_ref.content_id = pp.title_item_id
                  AND imdb_ref.provider = 'imdb'
                  AND imdb_ref.entity_type = CASE WHEN pp.media_type = 'movie' THEN 'movie' ELSE 'show' END
                 LEFT JOIN content_provider_refs tvdb_ref
                   ON tvdb_ref.content_id = pp.title_item_id
                  AND tvdb_ref.provider = 'tvdb'
                  AND tvdb_ref.entity_type = CASE WHEN pp.media_type = 'movie' THEN 'movie' ELSE 'show' END
                 WHERE pp.profile_id = $1::uuid AND pp.dismissed_at IS NULL`;
    const queryParams: unknown[] = [params.profileId];
    let paramIdx = 2;

    if (cursor) {
      query += ` AND (pp.last_activity_at < $${paramIdx} OR (pp.last_activity_at = $${paramIdx} AND pp.title_item_id < $${paramIdx + 1}::uuid))`;
      queryParams.push(cursor.sortValue, cursor.tieBreaker || null);
      paramIdx += 2;
    }

    query += ` ORDER BY pp.last_activity_at DESC, pp.title_item_id DESC LIMIT $${paramIdx}`;
    queryParams.push(params.limit + 1);

    const { rows } = await db.query(query, queryParams);
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: row.last_activity_at as Date, tieBreaker: String(row.title_item_id) }), mapContinueWatchingRow);
  }

  async listWatchlistPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);

    let query = `SELECT pli.item_id, pli.media_type, pli.added_at, pli.source_kind, pli.source_provider,
                        tmdb_ref.external_id AS title_provider_id,
                        imdb_ref.external_id AS imdb_id,
                        tvdb_ref.external_id AS tvdb_id
                 FROM user_state.profile_list_items pli
                 LEFT JOIN content_provider_refs tmdb_ref
                   ON tmdb_ref.content_id = pli.item_id
                  AND tmdb_ref.provider = 'tmdb'
                  AND tmdb_ref.entity_type = CASE WHEN pli.media_type = 'movie' THEN 'movie' ELSE 'show' END
                 LEFT JOIN content_provider_refs imdb_ref
                   ON imdb_ref.content_id = pli.item_id
                  AND imdb_ref.provider = 'imdb'
                  AND imdb_ref.entity_type = CASE WHEN pli.media_type = 'movie' THEN 'movie' ELSE 'show' END
                 LEFT JOIN content_provider_refs tvdb_ref
                   ON tvdb_ref.content_id = pli.item_id
                  AND tvdb_ref.provider = 'tvdb'
                  AND tvdb_ref.entity_type = CASE WHEN pli.media_type = 'movie' THEN 'movie' ELSE 'show' END
                 WHERE pli.profile_id = $1::uuid AND pli.list_kind = 'watchlist'`;
    const queryParams: unknown[] = [params.profileId];
    let paramIdx = 2;

    if (cursor) {
      query += ` AND (pli.added_at < $${paramIdx} OR (pli.added_at = $${paramIdx} AND pli.item_id < $${paramIdx + 1}::uuid))`;
      queryParams.push(cursor.sortValue, cursor.tieBreaker || null);
      paramIdx += 2;
    }

    query += ` ORDER BY pli.added_at DESC, pli.item_id DESC LIMIT $${paramIdx}`;
    queryParams.push(params.limit + 1);

    const { rows } = await db.query(query, queryParams);
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: row.added_at as Date, tieBreaker: String(row.item_id) }), mapListItemRow);
  }

  async assertProfileAccess(client: DbClient, params: { accountId: string; profileId: string }): Promise<void> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
  }

  async listRatingsPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);

    let query = `SELECT pr.item_id, pr.media_type, pr.rating, pr.rated_at, pr.source_kind, pr.source_provider,
                        tmdb_ref.external_id AS title_provider_id,
                        imdb_ref.external_id AS imdb_id,
                        tvdb_ref.external_id AS tvdb_id
                 FROM user_state.profile_ratings pr
                 LEFT JOIN content_provider_refs tmdb_ref
                   ON tmdb_ref.content_id = pr.item_id
                  AND tmdb_ref.provider = 'tmdb'
                  AND tmdb_ref.entity_type = CASE WHEN pr.media_type = 'movie' THEN 'movie' ELSE 'show' END
                 LEFT JOIN content_provider_refs imdb_ref
                   ON imdb_ref.content_id = pr.item_id
                  AND imdb_ref.provider = 'imdb'
                  AND imdb_ref.entity_type = CASE WHEN pr.media_type = 'movie' THEN 'movie' ELSE 'show' END
                 LEFT JOIN content_provider_refs tvdb_ref
                   ON tvdb_ref.content_id = pr.item_id
                  AND tvdb_ref.provider = 'tvdb'
                  AND tvdb_ref.entity_type = CASE WHEN pr.media_type = 'movie' THEN 'movie' ELSE 'show' END
                 WHERE pr.profile_id = $1::uuid`;
    const queryParams: unknown[] = [params.profileId];
    let paramIdx = 2;

    if (cursor) {
      query += ` AND (pr.rated_at < $${paramIdx} OR (pr.rated_at = $${paramIdx} AND pr.item_id < $${paramIdx + 1}::uuid))`;
      queryParams.push(cursor.sortValue, cursor.tieBreaker || null);
      paramIdx += 2;
    }

    query += ` ORDER BY pr.rated_at DESC, pr.item_id DESC LIMIT $${paramIdx}`;
    queryParams.push(params.limit + 1);

    const { rows } = await db.query(query, queryParams);
    return pageFromRows(rows as WatchReadRow[], params.limit, (row) => ({ sortValue: row.rated_at as Date, tieBreaker: String(row.item_id) }), mapRatingRow);
  }

  async listHistoryPage(client: DbClient, params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    await this.profileAccessService.assertOwnedProfile(client, params.profileId, params.accountId);
    const cursor = decodeWatchPageCursor(params.cursor);

    const query = `WITH event_rows AS (
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
                    SELECT tr.id,
                           tr.history_item_id AS item_id,
                           tr.history_media_type AS media_type,
                           tr.event_type,
                           tr.occurred_at,
                           tr.source_kind,
                           tr.source_provider,
                           tmdb_ref.external_id AS title_provider_id,
                           imdb_ref.external_id AS imdb_id,
                           tvdb_ref.external_id AS tvdb_id
                    FROM title_ranked tr
                    LEFT JOIN content_provider_refs tmdb_ref
                      ON tmdb_ref.content_id = tr.history_item_id
                     AND tmdb_ref.provider = 'tmdb'
                     AND tmdb_ref.entity_type = tr.history_media_type
                    LEFT JOIN content_provider_refs imdb_ref
                      ON imdb_ref.content_id = tr.history_item_id
                     AND imdb_ref.provider = 'imdb'
                     AND imdb_ref.entity_type = tr.history_media_type
                    LEFT JOIN content_provider_refs tvdb_ref
                      ON tvdb_ref.content_id = tr.history_item_id
                     AND tvdb_ref.provider = 'tvdb'
                     AND tvdb_ref.entity_type = tr.history_media_type
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
