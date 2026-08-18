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

export class LocalUserWatchService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async listContinueWatchingPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT ws.item_id AS playable_item_id, ws.title_item_id, ws.media_type,
              ws.position_seconds, ws.duration_seconds, ws.progress_bps,
              ws.updated_at AS last_activity_at, ws.season_number, ws.episode_number,
              sh_tmdb.external_id AS title_provider_id,
              sh_imdb.external_id AS imdb_id,
              sh_tvdb.external_id AS tvdb_id
       FROM user_state.watch_state ws
       LEFT JOIN content_provider_refs sh_tmdb
         ON sh_tmdb.content_id = ws.title_item_id
        AND sh_tmdb.provider = 'tmdb'
        AND sh_tmdb.entity_type = CASE WHEN ws.media_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs sh_imdb
         ON sh_imdb.content_id = ws.title_item_id
        AND sh_imdb.provider = 'imdb'
        AND sh_imdb.entity_type = CASE WHEN ws.media_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs sh_tvdb
         ON sh_tvdb.content_id = ws.title_item_id
        AND sh_tvdb.provider = 'tvdb'
        AND sh_tvdb.entity_type = CASE WHEN ws.media_type = 'movie' THEN 'movie' ELSE 'show' END
        WHERE ws.profile_id = $1::uuid AND NOT ws.played AND ws.position_seconds > 0
          AND ws.updated_at > now() - interval '${env.continueWatchingTtlDays} days'
          AND ($2::timestamptz IS NULL OR ws.updated_at < $2::timestamptz
               OR (ws.updated_at = $2::timestamptz AND ws.item_id > $3::uuid))
       ORDER BY ws.updated_at DESC, ws.item_id ASC
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
      `SELECT ws.item_id, ws.title_item_id, ws.media_type,
              ws.played, ws.play_count, ws.last_played_at,
              ws.position_seconds, ws.duration_seconds, ws.progress_bps,
              ws.season_number, ws.episode_number, ws.rating, ws.is_favorite,
              sh_tmdb.external_id AS title_provider_id,
              sh_imdb.external_id AS imdb_id,
              sh_tvdb.external_id AS tvdb_id
       FROM user_state.watch_state ws
       LEFT JOIN content_provider_refs sh_tmdb
         ON sh_tmdb.content_id = ws.title_item_id
        AND sh_tmdb.provider = 'tmdb'
        AND sh_tmdb.entity_type = CASE WHEN ws.media_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs sh_imdb
         ON sh_imdb.content_id = ws.title_item_id
        AND sh_imdb.provider = 'imdb'
        AND sh_imdb.entity_type = CASE WHEN ws.media_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs sh_tvdb
         ON sh_tvdb.content_id = ws.title_item_id
        AND sh_tvdb.provider = 'tvdb'
        AND sh_tvdb.entity_type = CASE WHEN ws.media_type = 'movie' THEN 'movie' ELSE 'show' END
       WHERE ws.profile_id = $1::uuid AND ws.is_favorite
         AND ($2::timestamptz IS NULL OR ws.updated_at < $2::timestamptz
              OR (ws.updated_at = $2::timestamptz AND ws.item_id > $3::uuid))
       ORDER BY ws.updated_at DESC, ws.item_id ASC
       LIMIT $4`,
      [params.profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit],
    );
    return pageFromRows(
      rows.rows as Record<string, unknown>[],
      params.limit,
      (row) => ({ sortValue: row.updated_at as Date, tieBreaker: String(row.item_id) }),
      (row) => mapWatchStateRow(row),
    );
  }

  async listRatingsPage(params: ListPageParams): Promise<PaginatedWatchCollection<BaseItemDto>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const limit = params.limit + 1;
    const rows = await db.query(
      `SELECT ws.item_id, ws.media_type, ws.rating, ws.updated_at AS rated_at,
              tmdb_ref.external_id AS title_provider_id,
              imdb_ref.external_id AS imdb_id,
              tvdb_ref.external_id AS tvdb_id
       FROM user_state.watch_state ws
       LEFT JOIN content_provider_refs tmdb_ref
         ON tmdb_ref.content_id = ws.item_id
        AND tmdb_ref.provider = 'tmdb'
        AND tmdb_ref.entity_type = CASE WHEN ws.media_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs imdb_ref
         ON imdb_ref.content_id = ws.item_id
        AND imdb_ref.provider = 'imdb'
        AND imdb_ref.entity_type = CASE WHEN ws.media_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs tvdb_ref
         ON tvdb_ref.content_id = ws.item_id
        AND tvdb_ref.provider = 'tvdb'
        AND tvdb_ref.entity_type = CASE WHEN ws.media_type = 'movie' THEN 'movie' ELSE 'show' END
       WHERE ws.profile_id = $1::uuid AND ws.rating IS NOT NULL
         AND ($2::timestamptz IS NULL OR ws.updated_at < $2::timestamptz
              OR (ws.updated_at = $2::timestamptz AND ws.item_id > $3::uuid))
       ORDER BY ws.updated_at DESC, ws.item_id ASC
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
      `SELECT ws.title_item_id AS item_id,
              CASE WHEN ci.entity_type = 'movie' THEN 'movie' ELSE 'show' END AS media_type,
              MAX(ws.last_played_at) AS occurred_at,
              sh_tmdb.external_id AS title_provider_id,
              sh_imdb.external_id AS imdb_id,
              sh_tvdb.external_id AS tvdb_id
       FROM user_state.watch_state ws
       JOIN content_items ci ON ci.id = ws.title_item_id
       LEFT JOIN content_provider_refs sh_tmdb
         ON sh_tmdb.content_id = ws.title_item_id
        AND sh_tmdb.provider = 'tmdb'
        AND sh_tmdb.entity_type = CASE WHEN ci.entity_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs sh_imdb
         ON sh_imdb.content_id = ws.title_item_id
        AND sh_imdb.provider = 'imdb'
        AND sh_imdb.entity_type = CASE WHEN ci.entity_type = 'movie' THEN 'movie' ELSE 'show' END
       LEFT JOIN content_provider_refs sh_tvdb
         ON sh_tvdb.content_id = ws.title_item_id
        AND sh_tvdb.provider = 'tvdb'
        AND sh_tvdb.entity_type = CASE WHEN ci.entity_type = 'movie' THEN 'movie' ELSE 'show' END
       WHERE ws.profile_id = $1::uuid AND ws.last_played_at IS NOT NULL
         AND ($2::uuid IS NULL OR ws.title_item_id = $2::uuid)
         AND ($3::timestamptz IS NULL OR ws.last_played_at < $3::timestamptz
              OR (ws.last_played_at = $3::timestamptz AND ws.title_item_id > $4::uuid))
       GROUP BY ws.title_item_id, ci.entity_type, sh_tmdb.external_id, sh_imdb.external_id, sh_tvdb.external_id
       ORDER BY occurred_at DESC, ws.title_item_id DESC
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
           ci.entity_type                    AS media_type,
           tmdb_ref.external_id             AS title_provider_id,
           imdb_ref.external_id             AS imdb_id,
           tvdb_ref.external_id             AS tvdb_id,
           ws.title_item_id,
           ws.played,
           ws.play_count,
           ws.last_played_at,
           ws.position_seconds,
           ws.duration_seconds,
           ws.progress_bps,
           ws.season_number,
           ws.episode_number,
           ws.rating,
           ws.is_favorite,
           show_tmdb_ref.external_id        AS show_tmdb_id
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
         LEFT JOIN user_state.watch_state ws
           ON ws.profile_id = $1::uuid AND ws.item_id = req.item_id
         LEFT JOIN content_provider_refs show_tmdb_ref
           ON show_tmdb_ref.content_id = ws.title_item_id
          AND show_tmdb_ref.provider = 'tmdb'
          AND show_tmdb_ref.entity_type = 'show'`,
        [params.profileId, itemIds],
      );

      return result.rows.map((row) => mapWatchStateRow(row as Record<string, unknown>));
    });
  }

  async recordPlaybackState(params: RecordPlaybackParams): Promise<void> {
    const progressBps = params.durationSeconds && params.durationSeconds > 0
      ? Math.round((params.positionSeconds ?? 0) / params.durationSeconds * 10000)
      : null;
    const playState = LocalUserWatchService.resolvePlayState(params.positionSeconds, params.durationSeconds);

    await withDbClient(async (client) => {
      const providedEpisodeNumbers = (params.seasonNumber != null && params.episodeNumber != null)
        ? { seasonNumber: params.seasonNumber, episodeNumber: params.episodeNumber }
        : null;
      const episodeNumbers = params.mediaType === 'episode'
        ? (providedEpisodeNumbers ?? await this.resolveEpisodeNumbers(client, params.itemId))
        : providedEpisodeNumbers;

      if (playState.played) {
        await client.query(
          `INSERT INTO user_state.watch_state
             (profile_id, account_id, item_id, title_item_id, media_type,
              season_number, episode_number, played, play_count,
              last_played_at, position_seconds, duration_seconds, progress_bps, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, true, 1,
                   now(), 0, $8, NULL, now())
           ON CONFLICT (profile_id, item_id) DO UPDATE SET
             played = true,
             play_count = user_state.watch_state.play_count + 1,
             last_played_at = now(),
             position_seconds = 0,
             progress_bps = 0,
              duration_seconds = EXCLUDED.duration_seconds,
              title_item_id = EXCLUDED.title_item_id,
              media_type = EXCLUDED.media_type,
             season_number = EXCLUDED.season_number,
             episode_number = EXCLUDED.episode_number,
             updated_at = now()`,
          [params.profileId, params.accountId, params.itemId, params.titleItemId, params.mediaType,
           episodeNumbers?.seasonNumber ?? null, episodeNumbers?.episodeNumber ?? null, params.durationSeconds],
        );
      } else {
        await client.query(
          `INSERT INTO user_state.watch_state
             (profile_id, account_id, item_id, title_item_id, media_type,
              season_number, episode_number, played, play_count,
              last_played_at, position_seconds, duration_seconds, progress_bps, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, false, 0,
                   NULL, $8, $9, $10, now())
           ON CONFLICT (profile_id, item_id) DO UPDATE SET
             position_seconds = EXCLUDED.position_seconds,
             duration_seconds = EXCLUDED.duration_seconds,
             progress_bps = EXCLUDED.progress_bps,
             title_item_id = EXCLUDED.title_item_id,
             media_type = EXCLUDED.media_type,
             season_number = EXCLUDED.season_number,
             episode_number = EXCLUDED.episode_number,
             updated_at = now()`,
          [params.profileId, params.accountId, params.itemId, params.titleItemId, params.mediaType,
           episodeNumbers?.seasonNumber ?? null, episodeNumbers?.episodeNumber ?? null,
           playState.positionSeconds, params.durationSeconds, progressBps],
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
      return pos > 0
        ? { played: true, positionSeconds: 0 }
        : { played: false, positionSeconds: 0 };
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
      `UPDATE user_state.watch_state
       SET position_seconds = 0, progress_bps = 0, updated_at = now()
       WHERE profile_id = $1::uuid AND item_id = $2::uuid`,
      [params.profileId, params.playableItemId],
    );

    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async setListItem(params: SetListItemParams): Promise<void> {
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';
    await db.query(
      `INSERT INTO user_state.watch_state
         (profile_id, account_id, item_id, title_item_id, media_type, is_favorite, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, true, now())
       ON CONFLICT (profile_id, item_id) DO UPDATE SET
         is_favorite = true, updated_at = now()`,
      [params.profileId, params.accountId, params.itemId, params.titleItemId, canonicalType],
    );
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async deleteListItem(params: DeleteListItemParams): Promise<void> {
    await db.query(
      `UPDATE user_state.watch_state
       SET is_favorite = false, updated_at = now()
       WHERE profile_id = $1::uuid AND item_id = $2::uuid`,
      [params.profileId, params.itemId],
    );
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async setRating(params: SetRatingParams): Promise<void> {
    const canonicalType = params.mediaType === 'movie' ? 'movie' : 'show';
    await db.query(
      `INSERT INTO user_state.watch_state
         (profile_id, account_id, item_id, title_item_id, media_type, rating, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $3::uuid, $4, $5, now())
       ON CONFLICT (profile_id, item_id) DO UPDATE SET
         rating = EXCLUDED.rating, updated_at = now()`,
      [params.accountId, params.profileId, params.itemId, canonicalType, params.rating],
    );
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async deleteRating(params: DeleteRatingParams): Promise<void> {
    await db.query(
      `UPDATE user_state.watch_state
       SET rating = NULL, updated_at = now()
       WHERE profile_id = $1::uuid AND item_id = $2::uuid`,
      [params.profileId, params.itemId],
    );
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async markWatched(params: MarkWatchedParams): Promise<void> {
    await withDbClient(async (client) => {
      const episodeNumbers = (params.seasonNumber != null && params.episodeNumber != null)
        ? { seasonNumber: params.seasonNumber, episodeNumber: params.episodeNumber }
        : (params.mediaType === 'episode' ? await this.resolveEpisodeNumbers(client, params.itemId) : null);
      await client.query(
        `INSERT INTO user_state.watch_state
           (profile_id, account_id, item_id, title_item_id, media_type,
            season_number, episode_number, played, play_count,
            last_played_at, position_seconds, progress_bps, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, true, 1,
                 now(), 0, NULL, now())
         ON CONFLICT (profile_id, item_id) DO UPDATE SET
           played = true,
           play_count = user_state.watch_state.play_count + 1,
           last_played_at = now(),
           position_seconds = 0,
           progress_bps = 0,
           title_item_id = EXCLUDED.title_item_id,
           season_number = EXCLUDED.season_number,
           episode_number = EXCLUDED.episode_number,
           updated_at = now()`,
        [params.accountId, params.profileId, params.itemId, params.titleItemId, params.mediaType,
         episodeNumbers?.seasonNumber ?? null, episodeNumbers?.episodeNumber ?? null],
      );
    });
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }

  async unmarkWatched(params: UnmarkWatchedParams): Promise<void> {
    await withDbClient(async (client) => {
      const episodeNumbers = (params.seasonNumber != null && params.episodeNumber != null)
        ? { seasonNumber: params.seasonNumber, episodeNumber: params.episodeNumber }
        : (params.mediaType === 'episode' ? await this.resolveEpisodeNumbers(client, params.itemId) : null);
      await client.query(
        `INSERT INTO user_state.watch_state
           (profile_id, account_id, item_id, title_item_id, media_type,
            season_number, episode_number, played, play_count, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, false, 0, now())
         ON CONFLICT (profile_id, item_id) DO UPDATE SET
           played = false,
           position_seconds = 0,
           progress_bps = 0,
           title_item_id = EXCLUDED.title_item_id,
           season_number = EXCLUDED.season_number,
           episode_number = EXCLUDED.episode_number,
           updated_at = now()`,
        [params.accountId, params.profileId, params.itemId, params.titleItemId, params.mediaType,
         episodeNumbers?.seasonNumber ?? null, episodeNumbers?.episodeNumber ?? null],
      );
    });
    await publishWatchChanged(params.accountId, params.profileId, 'continue_watching', { force: true });
  }
}

