import { db, withDbClient, type DbClient } from '../../lib/db.js';
import { env } from '../../config/env.js';
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
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { inferMediaIdentity, showTmdbIdForIdentity } from '../identity/media-key.js';
import { publishWatchChanged } from '../watch/watch-change.publisher.js';

/** Events that assert a title was watched. */
export const WATCHED_EVENT_TYPES = ['playback_completed', 'marked_watched'] as const;

/**
 * Every event that participates in resolving watched state. Watched state is
 * "latest event wins": the most recent of these (by occurred_at, then id)
 * decides, so an explicit unwatch always beats an older completion — including
 * completions replayed by a provider re-import with historical timestamps.
 */
export const WATCH_STATE_EVENT_TYPES = [...WATCHED_EVENT_TYPES, 'marked_unwatched'] as const;

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
  playableItemId: string;
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
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async listContinueWatchingPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT pp.title_item_id, pp.playable_item_id, pp.media_type,
              pp.position_seconds, pp.duration_seconds, pp.progress_bps,
              pp.last_activity_at, pp.season_number, pp.episode_number,
              pp.source_kind, pp.source_provider,
              sh_tmdb.external_id AS title_provider_id,
              sh_imdb.external_id AS imdb_id,
              sh_tvdb.external_id AS tvdb_id
       FROM user_state.playback_progress pp
       LEFT JOIN content_provider_refs sh_tmdb
         ON sh_tmdb.content_id = pp.title_item_id
        AND sh_tmdb.provider = 'tmdb'
        AND sh_tmdb.entity_type = CASE WHEN pp.media_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs sh_imdb
         ON sh_imdb.content_id = pp.title_item_id
        AND sh_imdb.provider = 'imdb'
        AND sh_imdb.entity_type = CASE WHEN pp.media_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs sh_tvdb
         ON sh_tvdb.content_id = pp.title_item_id
        AND sh_tvdb.provider = 'tvdb'
        AND sh_tvdb.entity_type = CASE WHEN pp.media_type = 'movie' THEN 'movie' ELSE 'show' END
        WHERE pp.profile_id = $1::uuid AND pp.dismissed_at IS NULL
          AND pp.last_activity_at > now() - interval '${env.continueWatchingTtlDays} days'
          AND ($2::timestamptz IS NULL OR pp.last_activity_at < $2::timestamptz
               OR (pp.last_activity_at = $2::timestamptz AND pp.playable_item_id > $3::uuid))
       ORDER BY pp.last_activity_at DESC, pp.playable_item_id ASC
       LIMIT $4`,
      [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit],
    );
    const page = pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: row.last_activity_at as Date, tieBreaker: String(row.playable_item_id) }),
      (row) => mapContinueWatchingRow(row),
    );
    return {
      items: page.items.filter((item): item is BaseItemDto => item !== null),
      pageInfo: page.pageInfo,
    };
  }

  async listWatchlistPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT pli.item_id, pli.media_type, pli.added_at, pli.source_kind, pli.source_provider,
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
      `SELECT pr.item_id, pr.media_type, pr.rating, pr.rated_at, pr.source_kind, pr.source_provider,
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
      query = `SELECT we.id, we.item_id, we.title_item_id, we.media_type, we.event_type, we.occurred_at, we.source_kind, we.source_provider,
                      tmdb_ref.external_id AS title_provider_id,
                      imdb_ref.external_id AS imdb_id,
                      tvdb_ref.external_id AS tvdb_id
               FROM user_state.watch_events we
               LEFT JOIN content_provider_refs tmdb_ref
                 ON tmdb_ref.content_id = we.title_item_id
                AND tmdb_ref.provider = 'tmdb'
                AND tmdb_ref.entity_type = CASE WHEN we.media_type = 'movie' THEN 'movie' ELSE 'show' END
               LEFT JOIN content_provider_refs imdb_ref
                 ON imdb_ref.content_id = we.title_item_id
                AND imdb_ref.provider = 'imdb'
                AND imdb_ref.entity_type = CASE WHEN we.media_type = 'movie' THEN 'movie' ELSE 'show' END
               LEFT JOIN content_provider_refs tvdb_ref
                 ON tvdb_ref.content_id = we.title_item_id
                AND tvdb_ref.provider = 'tvdb'
                AND tvdb_ref.entity_type = CASE WHEN we.media_type = 'movie' THEN 'movie' ELSE 'show' END
               WHERE we.profile_id = $1::uuid
                 AND we.event_type IN ('playback_completed', 'marked_watched')
                 AND we.title_item_id = $2::uuid
                 AND ($3::timestamptz IS NULL OR we.occurred_at < $3::timestamptz
                      OR (we.occurred_at = $3::timestamptz AND we.id < $4::uuid))
               ORDER BY we.occurred_at DESC, we.id DESC
               LIMIT $5`;
      queryParams.push(params.itemId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit);
    } else {
      query = `WITH latest_state AS (
                 SELECT we.title_item_id,
                        (array_agg(we.event_type ORDER BY we.occurred_at DESC, we.id DESC))[1]
                          = ANY (ARRAY['playback_completed', 'marked_watched']) AS is_watched
                 FROM user_state.watch_events we
                 WHERE we.profile_id = $1::uuid
                   AND we.event_type = ANY (ARRAY['playback_completed', 'marked_watched', 'marked_unwatched'])
                 GROUP BY we.title_item_id
               ),
               event_rows AS (
                 SELECT we.id,
                        we.title_item_id AS history_item_id,
                        CASE WHEN we.media_type = 'movie' THEN 'movie' ELSE 'show' END AS history_media_type,
                        we.event_type, we.occurred_at, we.source_kind, we.source_provider
                 FROM user_state.watch_events we
                 JOIN latest_state ls
                   ON ls.title_item_id = we.title_item_id AND ls.is_watched
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
           ci.entity_type                    AS media_type,
            tmdb_ref.external_id              AS title_provider_id,
            imdb_ref.external_id              AS imdb_id,
            tvdb_ref.external_id              AS tvdb_id,
            wa.show_tmdb_id,
            pb.position_seconds,
           pb.duration_seconds,
           pb.progress_bps,
           pb.last_activity_at,
           pb.title_item_id                  AS continue_title_item_id,
           pb.position_seconds               AS continue_position_seconds,
           pb.duration_seconds               AS continue_duration_seconds,
           pb.progress_bps                   AS continue_progress_bps,
           pb.last_activity_at               AS continue_last_activity_at,
           pb.dismissed_at                   AS continue_dismissed_at,
             li.added_at                       AS watchlist_added_at,
            rt.rating,
            rt.rated_at,
             COALESCE(wa.effective_watched, false) AS effective_watched,
             COALESCE(wa.play_count, 0)            AS play_count,
             wa.last_watched_at,
             wa.season_number,
             wa.episode_number
          FROM requested req
         LEFT JOIN content_items ci
           ON ci.id = req.item_id
         LEFT JOIN content_provider_refs tmdb_ref
           ON tmdb_ref.content_id = req.item_id
          AND tmdb_ref.provider = 'tmdb'
          AND tmdb_ref.entity_type = ci.entity_type
         LEFT JOIN content_provider_refs imdb_ref
           ON imdb_ref.content_id = req.item_id
          AND imdb_ref.provider = 'imdb'
          AND imdb_ref.entity_type = ci.entity_type
           LEFT JOIN content_provider_refs tvdb_ref
             ON tvdb_ref.content_id = req.item_id
            AND tvdb_ref.provider = 'tvdb'
            AND tvdb_ref.entity_type = ci.entity_type
           LEFT JOIN user_state.playback_progress pb
           ON pb.profile_id = $1::uuid AND pb.title_item_id = req.item_id AND pb.dismissed_at IS NULL
         LEFT JOIN user_state.profile_list_items li
           ON li.profile_id = $1::uuid AND li.list_kind = 'watchlist' AND li.item_id = req.item_id
         LEFT JOIN user_state.profile_ratings rt
           ON rt.profile_id = $1::uuid AND rt.item_id = req.item_id
          LEFT JOIN LATERAL (
             SELECT
              (array_agg(ev.event_type ORDER BY ev.occurred_at DESC, ev.id DESC))[1]
                = ANY ($3::text[])                                        AS effective_watched,
              CASE WHEN (array_agg(ev.event_type ORDER BY ev.occurred_at DESC, ev.id DESC))[1]
                = ANY ($3::text[])
                THEN count(*) FILTER (WHERE ev.event_type = ANY ($3::text[]))
                ELSE 0 END                                                AS play_count,
              max(ev.occurred_at) FILTER (WHERE ev.event_type = ANY ($3::text[])) AS last_watched_at,
              max(ev.season_number)                                       AS season_number,
              max(ev.episode_number)                                      AS episode_number,
              max(title_tmdb_ref.external_id)                             AS show_tmdb_id
             FROM user_state.watch_events ev
             LEFT JOIN content_provider_refs title_tmdb_ref
               ON title_tmdb_ref.content_id = ev.title_item_id
              AND title_tmdb_ref.provider = 'tmdb'
              AND title_tmdb_ref.entity_type = 'show'
             WHERE ev.profile_id = $1::uuid
               AND ev.item_id = req.item_id
               AND ev.event_type = ANY ($4::text[])
            ) wa ON true`,
         [params.profileId, itemIds, WATCHED_EVENT_TYPES, WATCH_STATE_EVENT_TYPES],
      );

      return result.rows.map((row) => mapWatchStateRow(row as Record<string, unknown>));
    });
  }

  async recordPlaybackState(params: RecordPlaybackParams): Promise<void> {
    const progressBps = params.durationSeconds && params.durationSeconds > 0
      ? Math.round((params.positionSeconds ?? 0) / params.durationSeconds * 10000)
      : null;

    const isCompleted = params.eventKind === 'playback_completed'
      && !LocalUserWatchService.isBelowCompletionThreshold(progressBps);

    await withDbClient(async (client) => {
      if (isCompleted) {
        const completedEpisodeNumbers = params.mediaType === 'episode'
          ? await this.resolveEpisodeNumbers(client, params.itemId)
          : null;
        await client.query(
          `INSERT INTO user_state.watch_events
             (account_id, profile_id, item_id, title_item_id, media_type, event_type,
              occurred_at, season_number, episode_number, position_seconds, duration_seconds, progress_bps,
              source_kind, last_actor_account_id, client_event_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'playback_completed',
                   COALESCE($6::timestamptz, now()), $7, $8, $9, $10, $11,
                   'local', $1::uuid, $12)
           RETURNING id`,
          [params.accountId, params.profileId, params.itemId, params.titleItemId, params.mediaType,
           params.occurredAt ?? null, completedEpisodeNumbers?.seasonNumber ?? null, completedEpisodeNumbers?.episodeNumber ?? null, params.positionSeconds, params.durationSeconds, progressBps,
           params.clientEventId ?? null],
        );

        await client.query(
          `DELETE FROM user_state.playback_progress
           WHERE profile_id = $1::uuid AND title_item_id = $2::uuid AND playable_item_id = $3::uuid`,
          [params.profileId, params.titleItemId, params.itemId],
        );

        if (params.mediaType === 'episode') {
          await this.advanceToNextEpisode(client, params.profileId, params.titleItemId, params.itemId, params.accountId);
        }
      } else {
        const episodeNumbers = params.mediaType === 'episode'
          ? await this.resolveEpisodeNumbers(client, params.itemId)
          : null;

        await client.query(
          `INSERT INTO user_state.playback_progress
             (profile_id, title_item_id, playable_item_id, media_type,
              position_seconds, duration_seconds, progress_bps, last_activity_at,
              season_number, episode_number,
              source_kind, account_id, last_actor_account_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, now(), $8, $9, 'local', $10::uuid, $10::uuid)
           ON CONFLICT (profile_id, title_item_id, playable_item_id) DO UPDATE SET
             playable_item_id = EXCLUDED.playable_item_id,
             position_seconds = EXCLUDED.position_seconds,
             duration_seconds = EXCLUDED.duration_seconds,
             progress_bps = EXCLUDED.progress_bps,
             last_activity_at = now(),
             season_number = EXCLUDED.season_number,
             episode_number = EXCLUDED.episode_number,
             dismissed_at = NULL,
             updated_at = now()`,
          [params.profileId, params.titleItemId, params.itemId, params.mediaType,
           params.positionSeconds, params.durationSeconds, progressBps,
           episodeNumbers?.seasonNumber ?? null, episodeNumbers?.episodeNumber ?? null,
           params.accountId],
        );
      }
    });

    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', {
      force: params.eventKind === 'playback_completed',
    });
  }

  static isBelowCompletionThreshold(progressBps: number | null): boolean {
    return progressBps !== null && progressBps < 9000;
  }

  private async resolveEpisodeNumbers(
    client: DbClient,
    playableItemId: string,
  ): Promise<{ seasonNumber: number; episodeNumber: number } | null> {
    try {
      const identity = await this.contentIdentityService.resolveMediaIdentity(client, playableItemId);
      if (identity.seasonNumber != null && identity.episodeNumber != null) {
        return { seasonNumber: identity.seasonNumber, episodeNumber: identity.episodeNumber };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async advanceToNextEpisode(
    client: DbClient,
    profileId: string,
    titleItemId: string,
    completedPlayableItemId: string,
    accountId: string,
  ): Promise<void> {
    const showIdentity = await this.resolveShowIdentity(client, titleItemId);
    if (!showIdentity) return;

    const showTmdbId = showTmdbIdForIdentity(showIdentity);
    if (!showTmdbId) return;

    const completedNumbers = await this.resolveEpisodeNumbers(client, completedPlayableItemId);
    if (!completedNumbers) return;

    const nextRow = await client.query(
      `SELECT season_number, episode_number, tmdb_id
       FROM tmdb_tv_episodes
       WHERE show_tmdb_id = $1
         AND (season_number > $2 OR (season_number = $2 AND episode_number > $3))
       ORDER BY season_number ASC, episode_number ASC
       LIMIT 1`,
      [showTmdbId, completedNumbers.seasonNumber, completedNumbers.episodeNumber],
    );
    if (nextRow.rows.length === 0) return;

    const next = nextRow.rows[0];
    const nextIdentity = inferMediaIdentity({
      mediaType: 'episode',
      provider: 'tmdb',
      parentProvider: 'tmdb',
      parentProviderId: String(showTmdbId),
      seasonNumber: next.season_number as number,
      episodeNumber: next.episode_number as number,
      providerMetadata: { tmdbId: showTmdbId, showTmdbId },
    });

    const nextContentId = await this.contentIdentityService.ensureContentId(client, nextIdentity);

    await client.query(
      `INSERT INTO user_state.playback_progress
         (profile_id, title_item_id, playable_item_id, media_type,
          position_seconds, duration_seconds, progress_bps, last_activity_at,
          season_number, episode_number,
          source_kind, account_id, last_actor_account_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'episode', 0, NULL, 0, now(), $4, $5, 'local', $6::uuid, $6::uuid)
       ON CONFLICT (profile_id, title_item_id, playable_item_id) DO NOTHING`,
      [profileId, titleItemId, nextContentId,
       next.season_number as number, next.episode_number as number, accountId],
    );
  }

  private async resolveShowIdentity(
    client: DbClient,
    titleItemId: string,
  ): Promise<import('../identity/media-key.js').MediaIdentity | null> {
    try {
      return await this.contentIdentityService.resolveMediaIdentity(client, titleItemId);
    } catch {
      return null;
    }
  }

  async resolveEpisodePlayableItemId(
    seriesTitleItemId: string,
    season: number,
    episode: number,
  ): Promise<string | null> {
    try {
      return await withDbClient(async (client) => {
        const showIdentity = await this.resolveShowIdentity(client, seriesTitleItemId);
        if (!showIdentity) return null;
        const showTmdbId = showTmdbIdForIdentity(showIdentity);
        if (!showTmdbId) return null;
        const episodeIdentity = inferMediaIdentity({
          mediaType: 'episode',
          provider: 'tmdb',
          parentProvider: 'tmdb',
          parentProviderId: String(showTmdbId),
          seasonNumber: season,
          episodeNumber: episode,
          providerMetadata: { tmdbId: showTmdbId, showTmdbId },
        });
        return this.contentIdentityService.ensureContentId(client, episodeIdentity);
      });
    } catch {
      return null;
    }
  }

  async dismissContinueWatching(params: DismissContinueWatchingParams): Promise<void> {
    await db.query(
      `UPDATE user_state.playback_progress
       SET dismissed_at = now(), updated_at = now()
       WHERE profile_id = $1::uuid AND title_item_id = $2::uuid AND playable_item_id = $3::uuid`,
      [params.profileId, params.titleItemId, params.playableItemId],
    );

    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
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

    await withDbClient(async (client) => {
      const episodeNumbers = params.mediaType === 'episode'
        ? await this.resolveEpisodeNumbers(client, params.itemId)
        : null;
      await client.query(
        `INSERT INTO user_state.watch_events
           (account_id, profile_id, item_id, title_item_id, media_type, event_type,
            occurred_at, season_number, episode_number, source_kind, last_actor_account_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'marked_watched',
                 $6::timestamptz, $7, $8, 'local', $1::uuid)`,
        [params.accountId, params.profileId, params.itemId, params.titleItemId, params.mediaType, occurredAt, episodeNumbers?.seasonNumber ?? null, episodeNumbers?.episodeNumber ?? null],
      );

      await client.query(
        `DELETE FROM user_state.playback_progress
         WHERE profile_id = $1::uuid AND title_item_id = $2::uuid AND playable_item_id = $3::uuid`,
        [params.profileId, params.titleItemId, params.itemId],
      );

      if (params.mediaType === 'episode') {
        await this.advanceToNextEpisode(client, params.profileId, params.titleItemId, params.itemId, params.accountId);
      }
    });
  }

  async unmarkWatched(params: UnmarkWatchedParams): Promise<void> {
    const occurredAt = params.occurredAt || new Date().toISOString();

    await withDbClient(async (client) => {
      await db.query(
        `INSERT INTO user_state.watch_events
           (account_id, profile_id, item_id, title_item_id, media_type, event_type,
            occurred_at, source_kind, last_actor_account_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'marked_unwatched',
                 $6::timestamptz, 'local', $1::uuid)`,
        [params.accountId, params.profileId, params.itemId, params.titleItemId, params.mediaType, occurredAt],
      );

      const episodeNumbers = params.mediaType === 'episode'
        ? await this.resolveEpisodeNumbers(client, params.itemId)
        : null;

      await client.query(
        `INSERT INTO user_state.playback_progress
           (profile_id, title_item_id, playable_item_id, media_type,
            position_seconds, duration_seconds, progress_bps, last_activity_at,
            season_number, episode_number,
            source_kind, account_id, last_actor_account_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 0, NULL, 0, now(), $5, $6, 'local', $7::uuid, $7::uuid)
         ON CONFLICT (profile_id, title_item_id, playable_item_id) DO UPDATE SET
           position_seconds = 0,
           progress_bps = 0,
           last_activity_at = now(),
           dismissed_at = NULL,
           updated_at = now()`,
        [params.profileId, params.titleItemId, params.itemId, params.mediaType,
         episodeNumbers?.seasonNumber ?? null, episodeNumbers?.episodeNumber ?? null,
         params.accountId],
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
