import { db, withDbClient, type DbClient } from '../../lib/db.js';
import { env } from '../../config/env.js';
import { decodeWatchPageCursor } from '../watch/watch-pagination.js';
import type { BaseItemDto } from '../metadata/media-item.types.js';
import type { PaginatedWatchCollection } from '../watch/watch-read.types.js';
import { pageFromRows } from './watch-read-helpers.js';
import {
  mapContinueWatchingRow,
  mapHistoryRow,
  mapRatingRow,
  mapWatchStateRow,
  type WatchReadRow,
} from './watch-read.mapper.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { inferMediaIdentity, showTmdbIdForIdentity } from '../identity/media-key.js';
import { publishWatchChanged } from '../watch/watch-change.publisher.js';

type RecordPlaybackParams = {
  accountId: string;
  profileId: string;
  itemId: string;
  titleItemId: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  positionSeconds: number | null;
  durationSeconds: number | null;
  occurredAt?: string | null;
  clientEventId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
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
  itemId: string;
  titleItemId: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
};

type DeleteListItemParams = {
  accountId: string;
  profileId: string;
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
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

type UnmarkWatchedParams = {
  accountId: string;
  profileId: string;
  itemId: string;
  titleItemId: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  occurredAt?: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
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

/**
 * Jellyfin-style read model: user_state.watch_state stores only per-(profile,item)
 * user state. Descriptive attributes (media type, series linkage, season/episode,
 * provider ids, runtime) live on the content graph and are derived at read time via
 * these joins — mirroring how Jellyfin resolves UserData attributes from the Item.
 */
export const WATCH_ITEM_CONTENT_JOIN = `
  JOIN content_items ci ON ci.id = ws.item_id
  LEFT JOIN content_item_relationships cir
    ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
  LEFT JOIN content_provider_refs cpr_tmdb
    ON cpr_tmdb.content_id = ws.item_id AND cpr_tmdb.provider = 'tmdb'
  LEFT JOIN content_provider_refs cpr_tmdb_show
    ON cpr_tmdb_show.content_id = cir.parent_content_id AND cpr_tmdb_show.provider = 'tmdb'
  LEFT JOIN content_provider_refs cpr_imdb
    ON cpr_imdb.content_id = ws.item_id AND cpr_imdb.provider = 'imdb'
  LEFT JOIN content_provider_refs cpr_imdb_show
    ON cpr_imdb_show.content_id = cir.parent_content_id AND cpr_imdb_show.provider = 'imdb'
  LEFT JOIN content_provider_refs cpr_tvdb
    ON cpr_tvdb.content_id = ws.item_id AND cpr_tvdb.provider = 'tvdb'
  LEFT JOIN content_provider_refs cpr_tvdb_show
    ON cpr_tvdb_show.content_id = cir.parent_content_id AND cpr_tvdb_show.provider = 'tvdb'
  -- Runtime is canonical from TMDB metadata, not the playing file. Titles are cached
  -- under the effective metadata language (usually 'en'), so pick the best English row
  -- rather than hard-filtering on 'en-US'.
  LEFT JOIN LATERAL (
    SELECT t.runtime
    FROM tmdb_titles t
    WHERE t.media_type = 'movie'
      AND t.tmdb_id = CASE WHEN ci.entity_type = 'movie' THEN cpr_tmdb.external_id::integer END
    ORDER BY CASE WHEN t.language = 'en-US' THEN 0 WHEN t.language = 'en' THEN 1 ELSE 2 END
    LIMIT 1
  ) tt ON true
  LEFT JOIN tmdb_tv_episodes tve
    ON tve.show_tmdb_id = cpr_tmdb_show.external_id::integer
   AND tve.season_number = NULLIF(cpr_tmdb.metadata->>'seasonNumber', '')::integer
   AND tve.episode_number = NULLIF(cpr_tmdb.metadata->>'episodeNumber', '')::integer
  LEFT JOIN LATERAL (
    SELECT t.episode_run_time
    FROM tmdb_titles t
    WHERE t.media_type = 'show'
      AND t.tmdb_id = cpr_tmdb_show.external_id::integer
    ORDER BY CASE WHEN t.language = 'en-US' THEN 0 WHEN t.language = 'en' THEN 1 ELSE 2 END
    LIMIT 1
  ) tt_show ON true
`;

const WATCH_ITEM_CONTENT_COLS = `
  CASE WHEN ci.entity_type = 'movie' THEN 'movie'
       WHEN ci.entity_type = 'episode' THEN 'episode'
       ELSE 'show' END AS media_type,
  cir.parent_content_id AS title_item_id,
  NULLIF(cpr_tmdb.metadata->>'seasonNumber', '')::integer AS season_number,
  NULLIF(cpr_tmdb.metadata->>'episodeNumber', '')::integer AS episode_number,
  CASE WHEN ci.entity_type = 'episode' THEN cpr_tmdb_show.external_id
       ELSE cpr_tmdb.external_id END AS title_provider_id,
  CASE WHEN ci.entity_type = 'episode' THEN cpr_imdb_show.external_id
       ELSE cpr_imdb.external_id END AS imdb_id,
  CASE WHEN ci.entity_type = 'episode' THEN cpr_tvdb_show.external_id
       ELSE cpr_tvdb.external_id END AS tvdb_id,
  COALESCE(tve.runtime * 60, tt.runtime * 60, (tt_show.episode_run_time->>0)::integer * 60) AS duration_seconds,
  CASE WHEN COALESCE(tve.runtime * 60, tt.runtime * 60, (tt_show.episode_run_time->>0)::integer * 60) > 0 AND ws.position_seconds > 0
       THEN round(ws.position_seconds / COALESCE(tve.runtime * 60, tt.runtime * 60, (tt_show.episode_run_time->>0)::integer * 60) * 10000)
       END AS progress_bps
`;

export class LocalUserWatchService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async listContinueWatchingPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT ws.item_id AS playable_item_id,
              ws.position_seconds, ws.last_played_at AS last_activity_at,
              ${WATCH_ITEM_CONTENT_COLS}
       FROM user_state.watch_state ws
       ${WATCH_ITEM_CONTENT_JOIN}
       WHERE ws.profile_id = $1::uuid AND NOT ws.played AND ws.position_seconds > 0
         AND ws.last_played_at > now() - interval '${env.continueWatchingTtlDays} days'
         AND ($2::timestamptz IS NULL OR ws.last_played_at < $2::timestamptz
              OR (ws.last_played_at = $2::timestamptz AND ws.item_id > $3::uuid))
       ORDER BY ws.last_played_at DESC, ws.item_id ASC
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

  /**
   * Next Up: the first not-yet-play episode that follows the furthest episode a
   * profile has watched in each series. Built entirely from the existing Jellyfin
   * style content graph + watch_state (no provider-specific continuation hacks).
   */
  async listNextUpPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `WITH watched_episodes AS (
          SELECT ws.item_id,
                 ws.last_played_at,
                 NULLIF(cpr.metadata->>'seasonNumber', '')::integer AS season,
                 NULLIF(cpr.metadata->>'episodeNumber', '')::integer AS episode,
                 cir.parent_content_id AS show_id
          FROM user_state.watch_state ws
          JOIN content_items ci ON ci.id = ws.item_id AND ci.entity_type = 'episode'
          JOIN content_provider_refs cpr
            ON cpr.content_id = ws.item_id AND cpr.provider = 'tmdb'
          JOIN content_item_relationships cir
            ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
          WHERE ws.profile_id = $1::uuid AND ws.last_played_at IS NOT NULL
        ),
        latest_watched AS (
          SELECT DISTINCT ON (show_id) show_id, season, episode, last_played_at
          FROM watched_episodes
          ORDER BY show_id, season DESC, episode DESC, last_played_at DESC
        ),
        next_episodes AS (
          SELECT DISTINCT ON (lw.show_id) lw.show_id, ep.id AS next_item_id, lw.last_played_at
          FROM latest_watched lw
          JOIN content_item_relationships cir2
            ON cir2.parent_content_id = lw.show_id AND cir2.relationship_type = 'series'
          JOIN content_items ep ON ep.id = cir2.child_content_id AND ep.entity_type = 'episode'
          JOIN content_provider_refs ep_cpr
            ON ep_cpr.content_id = ep.id AND ep_cpr.provider = 'tmdb'
          WHERE (NULLIF(ep_cpr.metadata->>'seasonNumber', '')::integer,
                 NULLIF(ep_cpr.metadata->>'episodeNumber', '')::integer)
                > (lw.season, lw.episode)
          ORDER BY lw.show_id,
                   NULLIF(ep_cpr.metadata->>'seasonNumber', '')::integer ASC,
                   NULLIF(ep_cpr.metadata->>'episodeNumber', '')::integer ASC
        ),
        candidate AS (
          SELECT ne.show_id, ne.next_item_id, ne.last_played_at
          FROM next_episodes ne
          LEFT JOIN user_state.watch_state ws2
            ON ws2.profile_id = $1::uuid AND ws2.item_id = ne.next_item_id
          WHERE ws2.played IS NOT TRUE
        ),
        ws AS (
          SELECT c.next_item_id AS item_id,
                 0 AS position_seconds,
                 c.last_played_at AS last_played_at,
                 $1::uuid AS profile_id
          FROM candidate c
        )
        SELECT ws.item_id AS playable_item_id,
               ws.position_seconds,
               ws.last_played_at AS last_activity_at,
               ${WATCH_ITEM_CONTENT_COLS}
        FROM ws
        ${WATCH_ITEM_CONTENT_JOIN}
        WHERE ws.profile_id = $1::uuid
          AND ($2::timestamptz IS NULL OR ws.last_played_at < $2::timestamptz
               OR (ws.last_played_at = $2::timestamptz AND ws.item_id > $3::uuid))
        ORDER BY ws.last_played_at DESC, ws.item_id ASC
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
      `SELECT ws.item_id, ws.played, ws.play_count, ws.last_played_at,
              ws.position_seconds, ws.rating, ws.is_favorite,
              ${WATCH_ITEM_CONTENT_COLS}
       FROM user_state.watch_state ws
       ${WATCH_ITEM_CONTENT_JOIN}
       WHERE ws.profile_id = $1::uuid AND ws.is_favorite
         AND ($2::timestamptz IS NULL OR ws.last_played_at < $2::timestamptz
              OR (ws.last_played_at = $2::timestamptz AND ws.item_id > $3::uuid))
       ORDER BY ws.last_played_at DESC, ws.item_id ASC
       LIMIT $4`,
      [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit],
    );
    return pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: row.last_played_at as Date, tieBreaker: String(row.item_id) }),
      (row) => mapWatchStateRow(row),
    );
  }

  async listRatingsPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT ws.item_id, ws.rating, ws.last_played_at AS rated_at,
              ${WATCH_ITEM_CONTENT_COLS}
       FROM user_state.watch_state ws
       ${WATCH_ITEM_CONTENT_JOIN}
       WHERE ws.profile_id = $1::uuid AND ws.rating IS NOT NULL
         AND ($2::timestamptz IS NULL OR ws.last_played_at < $2::timestamptz
              OR (ws.last_played_at = $2::timestamptz AND ws.item_id > $3::uuid))
       ORDER BY ws.last_played_at DESC, ws.item_id ASC
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
    const rows = await db.query(
      `SELECT ws.item_id,
              ${WATCH_ITEM_CONTENT_COLS},
              ws.last_played_at AS occurred_at
       FROM user_state.watch_state ws
       ${WATCH_ITEM_CONTENT_JOIN}
       WHERE ws.profile_id = $1::uuid AND ws.last_played_at IS NOT NULL
         AND ($2::uuid IS NULL OR ws.item_id = $2::uuid OR cir.parent_content_id = $2::uuid)
         AND ($3::timestamptz IS NULL OR ws.last_played_at < $3::timestamptz
              OR (ws.last_played_at = $3::timestamptz AND ws.item_id > $4::uuid))
       ORDER BY ws.last_played_at DESC, ws.item_id ASC
       LIMIT $5`,
      [params.profileId, params.itemId ?? null, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit],
    );
    return pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: row.occurred_at as Date, tieBreaker: String(row.item_id) }),
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
           CASE WHEN ci.entity_type = 'movie' THEN 'movie'
                WHEN ci.entity_type = 'episode' THEN 'episode'
                ELSE 'show' END         AS media_type,
           cir.parent_content_id        AS title_item_id,
           NULLIF(cpr_tmdb.metadata->>'seasonNumber', '')::integer  AS season_number,
           NULLIF(cpr_tmdb.metadata->>'episodeNumber', '')::integer AS episode_number,
           CASE WHEN ci.entity_type = 'episode' THEN cpr_tmdb_show.external_id
                ELSE cpr_tmdb.external_id END  AS title_provider_id,
           CASE WHEN ci.entity_type = 'episode' THEN cpr_imdb_show.external_id
                ELSE cpr_imdb.external_id END  AS imdb_id,
           CASE WHEN ci.entity_type = 'episode' THEN cpr_tvdb_show.external_id
                ELSE cpr_tvdb.external_id END  AS tvdb_id,
            COALESCE(tve.runtime * 60, tt.runtime * 60, (tt_show.episode_run_time->>0)::integer * 60) AS duration_seconds,
            CASE WHEN COALESCE(tve.runtime * 60, tt.runtime * 60, (tt_show.episode_run_time->>0)::integer * 60) > 0 AND ws.position_seconds > 0
                 THEN round(ws.position_seconds / COALESCE(tve.runtime * 60, tt.runtime * 60, (tt_show.episode_run_time->>0)::integer * 60) * 10000)
                 END AS progress_bps,
           cpr_tmdb_show.external_id    AS show_tmdb_id,
           ws.played,
           ws.play_count,
           ws.last_played_at,
           ws.position_seconds,
           ws.rating,
           ws.is_favorite
         FROM requested req
         LEFT JOIN content_items ci
           ON ci.id = req.item_id
         LEFT JOIN content_provider_refs cpr_tmdb
           ON cpr_tmdb.content_id = req.item_id
          AND cpr_tmdb.provider = 'tmdb'
          AND cpr_tmdb.entity_type = ci.entity_type
         LEFT JOIN content_provider_refs cpr_imdb
           ON cpr_imdb.content_id = req.item_id
          AND cpr_imdb.provider = 'imdb'
          AND cpr_imdb.entity_type = ci.entity_type
         LEFT JOIN content_provider_refs cpr_tvdb
           ON cpr_tvdb.content_id = req.item_id
          AND cpr_tvdb.provider = 'tvdb'
          AND cpr_tvdb.entity_type = ci.entity_type
         LEFT JOIN content_item_relationships cir
           ON cir.child_content_id = req.item_id AND cir.relationship_type = 'series'
         LEFT JOIN content_provider_refs cpr_tmdb_show
           ON cpr_tmdb_show.content_id = cir.parent_content_id
          AND cpr_tmdb_show.provider = 'tmdb'
          AND cpr_tmdb_show.entity_type = 'show'
         LEFT JOIN content_provider_refs cpr_imdb_show
           ON cpr_imdb_show.content_id = cir.parent_content_id
          AND cpr_imdb_show.provider = 'imdb'
          AND cpr_imdb_show.entity_type = 'show'
         LEFT JOIN content_provider_refs cpr_tvdb_show
           ON cpr_tvdb_show.content_id = cir.parent_content_id
          AND cpr_tvdb_show.provider = 'tvdb'
          AND cpr_tvdb_show.entity_type = 'show'
          LEFT JOIN LATERAL (
            SELECT t.runtime
            FROM tmdb_titles t
            WHERE t.media_type = 'movie'
              AND t.tmdb_id = CASE WHEN ci.entity_type = 'movie' THEN cpr_tmdb.external_id::integer END
            ORDER BY CASE WHEN t.language = 'en-US' THEN 0 WHEN t.language = 'en' THEN 1 ELSE 2 END
            LIMIT 1
          ) tt ON true
          LEFT JOIN tmdb_tv_episodes tve
            ON tve.show_tmdb_id = cpr_tmdb_show.external_id::integer
           AND tve.season_number = NULLIF(cpr_tmdb.metadata->>'seasonNumber', '')::integer
           AND tve.episode_number = NULLIF(cpr_tmdb.metadata->>'episodeNumber', '')::integer
          LEFT JOIN LATERAL (
            SELECT t.episode_run_time
            FROM tmdb_titles t
            WHERE t.media_type = 'show'
              AND t.tmdb_id = cpr_tmdb_show.external_id::integer
            ORDER BY CASE WHEN t.language = 'en-US' THEN 0 WHEN t.language = 'en' THEN 1 ELSE 2 END
            LIMIT 1
          ) tt_show ON true
         LEFT JOIN user_state.watch_state ws
           ON ws.profile_id = $1::uuid AND ws.item_id = req.item_id`,
        [params.profileId, itemIds],
      );

      return result.rows.map((row) => mapWatchStateRow(row as Record<string, unknown>));
    });
  }

  async recordPlaybackState(params: RecordPlaybackParams): Promise<void> {
    // Runtime is canonical from TMDB metadata (same source the read model uses), not
    // from the playing file. Prefer it; fall back to the client's reported duration only
    // for off-TMDB titles where no TMDB runtime is cached.
    const canonicalRuntime = await this.resolveCanonicalRuntimeSeconds(params.itemId);
    const runtime = canonicalRuntime ?? params.durationSeconds ?? null;
    const playState = LocalUserWatchService.resolvePlayState(params.positionSeconds, runtime);

    await withDbClient(async (client) => {
      if (playState.played) {
        await client.query(
          `INSERT INTO user_state.watch_state
             (profile_id, item_id, played, play_count, last_played_at, position_seconds)
           VALUES ($1::uuid, $2::uuid, true, 1, now(), 0)
           ON CONFLICT (profile_id, item_id) DO UPDATE SET
             played = true,
             play_count = user_state.watch_state.play_count + 1,
             last_played_at = now(),
             position_seconds = 0`,
          [params.profileId, params.itemId],
        );
      } else {
        await client.query(
          `INSERT INTO user_state.watch_state
             (profile_id, item_id, played, play_count, last_played_at, position_seconds)
           VALUES ($1::uuid, $2::uuid, false, 0, now(), $3)
           ON CONFLICT (profile_id, item_id) DO UPDATE SET
             position_seconds = EXCLUDED.position_seconds,
             last_played_at = now()`,
          [params.profileId, params.itemId, playState.positionSeconds],
        );
      }
    });

    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', {
      force: playState.played,
    });
  }

  /**
   * Jellyfin-style play-state resolution (UserDataManager.UpdatePlayState): the
   * watched state is decided purely from reported position vs runtime, never from
   * a client-supplied event type. Near-zero starts are ignored (no resume entry);
   * reaching the end (or >= MaxResumePct) marks the item played and clears the
   * resume point.
   */
  static resolvePlayState(
    positionSeconds: number | null,
    durationSeconds: number | null,
  ): { played: boolean; positionSeconds: number } {
    const pos = positionSeconds ?? 0;
    const hasRuntime = durationSeconds != null && durationSeconds > 0;

    if (!hasRuntime) {
      // Without a runtime we cannot decide "watched", so keep the item in progress and
      // preserve the resume point rather than wrongly marking it played (the earlier
      // position-only regression). Off-TMDB titles usually still report a client duration.
      return { played: false, positionSeconds: pos };
    }

    const pct = pos / durationSeconds * 100;
    const MIN_RESUME_PCT = 5;
    const MAX_RESUME_PCT = 90;

    if (pct < MIN_RESUME_PCT) {
      return { played: false, positionSeconds: 0 };
    }
    if (pct > MAX_RESUME_PCT || pos >= durationSeconds - 1) {
      return { played: true, positionSeconds: 0 };
    }
    return { played: false, positionSeconds: pos };
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

  /**
   * Canonical runtime (seconds) for an item, derived from TMDB metadata via the same
   * language-tolerant join the read model uses. Returns null only when no TMDB runtime
   * is cached (off-TMDB / not-yet-fetched titles), in which case the caller may fall
   * back to a client-reported duration.
   */
  private async resolveCanonicalRuntimeSeconds(itemId: string): Promise<number | null> {
    const result = await db.query(
      `SELECT COALESCE(tve.runtime * 60, tt.runtime * 60, (tt_show.episode_run_time->>0)::integer * 60) AS duration_seconds
       FROM content_items ci
       LEFT JOIN content_item_relationships cir
         ON cir.child_content_id = ci.id AND cir.relationship_type = 'series'
       LEFT JOIN content_provider_refs cpr_tmdb
         ON cpr_tmdb.content_id = ci.id AND cpr_tmdb.provider = 'tmdb'
       LEFT JOIN content_provider_refs cpr_tmdb_show
         ON cpr_tmdb_show.content_id = cir.parent_content_id AND cpr_tmdb_show.provider = 'tmdb'
       LEFT JOIN LATERAL (
         SELECT t.runtime FROM tmdb_titles t
         WHERE t.media_type = 'movie'
           AND t.tmdb_id = CASE WHEN ci.entity_type = 'movie' THEN cpr_tmdb.external_id::integer END
         ORDER BY CASE WHEN t.language = 'en-US' THEN 0 WHEN t.language = 'en' THEN 1 ELSE 2 END
         LIMIT 1
       ) tt ON true
       LEFT JOIN tmdb_tv_episodes tve
         ON tve.show_tmdb_id = cpr_tmdb_show.external_id::integer
        AND tve.season_number = NULLIF(cpr_tmdb.metadata->>'seasonNumber', '')::integer
        AND tve.episode_number = NULLIF(cpr_tmdb.metadata->>'episodeNumber', '')::integer
       LEFT JOIN LATERAL (
         SELECT t.episode_run_time FROM tmdb_titles t
         WHERE t.media_type = 'show'
           AND t.tmdb_id = cpr_tmdb_show.external_id::integer
         ORDER BY CASE WHEN t.language = 'en-US' THEN 0 WHEN t.language = 'en' THEN 1 ELSE 2 END
         LIMIT 1
       ) tt_show ON true
       WHERE ci.id = $1::uuid`,
      [itemId],
    );
    const raw = result.rows[0]?.duration_seconds;
    return raw != null ? Number(raw) : null;
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
      `UPDATE user_state.watch_state
       SET position_seconds = 0
       WHERE profile_id = $1::uuid AND item_id = $2::uuid`,
      [params.profileId, params.playableItemId],
    );

    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async setListItem(params: SetListItemParams): Promise<void> {
    await db.query(
      `INSERT INTO user_state.watch_state
        (profile_id, item_id, is_favorite)
       VALUES ($1::uuid, $2::uuid, true)
       ON CONFLICT (profile_id, item_id) DO UPDATE SET is_favorite = true`,
      [params.profileId, params.itemId],
    );
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async deleteListItem(params: DeleteListItemParams): Promise<void> {
    await db.query(
      `UPDATE user_state.watch_state
       SET is_favorite = false
       WHERE profile_id = $1::uuid AND item_id = $2::uuid`,
      [params.profileId, params.itemId],
    );
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async setRating(params: SetRatingParams): Promise<void> {
    await db.query(
      `INSERT INTO user_state.watch_state
        (profile_id, item_id, rating, last_played_at)
       VALUES ($1::uuid, $2::uuid, $3, now())
       ON CONFLICT (profile_id, item_id) DO UPDATE SET
         rating = EXCLUDED.rating, last_played_at = EXCLUDED.last_played_at`,
      [params.profileId, params.itemId, params.rating],
    );
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async deleteRating(params: DeleteRatingParams): Promise<void> {
    await db.query(
      `UPDATE user_state.watch_state
        SET rating = NULL
        WHERE profile_id = $1::uuid AND item_id = $2::uuid`,
      [params.profileId, params.itemId],
    );
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async markWatched(params: MarkWatchedParams): Promise<void> {
    await withDbClient(async (client) => {
      await client.query(
        `INSERT INTO user_state.watch_state
            (profile_id, item_id, played, play_count, last_played_at, position_seconds)
          VALUES ($1::uuid, $2::uuid, true, 1, now(), 0)
          ON CONFLICT (profile_id, item_id) DO UPDATE SET
            played = true,
            play_count = user_state.watch_state.play_count + 1,
            last_played_at = now(),
            position_seconds = 0`,
        [params.profileId, params.itemId],
      );
    });
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async unmarkWatched(params: UnmarkWatchedParams): Promise<void> {
    await withDbClient(async (client) => {
      await client.query(
        `INSERT INTO user_state.watch_state
            (profile_id, item_id, played, play_count, last_played_at, position_seconds)
          VALUES ($1::uuid, $2::uuid, false, 0, NULL, 0)
          ON CONFLICT (profile_id, item_id) DO UPDATE SET
            played = false,
            position_seconds = 0`,
        [params.profileId, params.itemId],
      );
    });
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }
}

