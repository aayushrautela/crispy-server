import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { inferMediaIdentity, parseMediaKey, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';

export type EpisodicFollowRow = {
  titleContentId: string;
  seriesMediaKey: string;
  seriesMediaType: 'show';
  provider: string;
  providerId: string;
  reason: string;
  lastInteractedAt: string;
  nextEpisodeAirDate: string | null;
  nextEpisodeMediaKey: string | null;
  nextEpisodeSeasonNumber: number | null;
  nextEpisodeEpisodeNumber: number | null;
  nextEpisodeAbsoluteEpisodeNumber: number | null;
  nextEpisodeTitle: string | null;
  metadataRefreshedAt: string | null;
  payload: Record<string, unknown>;
  showTmdbId: number | null;
};

export class WatchV2EpisodicFollowQueryService {
  constructor(private readonly contentIdentityService = new ContentIdentityService()) {}

  async listEpisodicFollow(client: DbClient, profileId: string, limit = 100): Promise<EpisodicFollowRow[]> {
    const result = await client.query(
      `
        SELECT
          projection.title_content_id,
          projection.title_media_key,
          projection.title_media_type,
          projection.title_provider,
          projection.title_provider_id,
          CASE
            WHEN projection.watchlist_present = true THEN 'watchlist'
            WHEN projection.rating_value IS NOT NULL THEN 'rating'
            ELSE 'watch_activity'
          END AS reason,
          COALESCE(
            projection.last_activity_at,
            projection.last_watched_at,
            projection.rated_at,
            projection.watchlist_updated_at
          ) AS last_interacted_at,
          metadata.next_episode_air_date,
          metadata.next_episode_media_key,
          metadata.next_episode_season_number,
          metadata.next_episode_episode_number,
          metadata.next_episode_absolute_episode_number,
          metadata.next_episode_title,
          metadata.metadata_refreshed_at,
          COALESCE(metadata.payload, '{}'::jsonb) AS payload
        FROM profile_title_projection projection
        LEFT JOIN profile_episodic_follow_state metadata
          ON metadata.profile_id = projection.profile_id
         AND metadata.title_content_id = projection.title_content_id
        WHERE projection.profile_id = $1::uuid
          AND projection.title_media_type = 'show'
          AND (
            projection.has_in_progress = true
            OR projection.effective_watched = true
            OR projection.watchlist_present = true
            OR projection.rating_value IS NOT NULL
          )
        ORDER BY
          COALESCE(metadata.next_episode_air_date, DATE '9999-12-31') ASC,
          COALESCE(
            projection.last_activity_at,
            projection.last_watched_at,
            projection.rated_at,
            projection.watchlist_updated_at
          ) DESC,
          projection.title_content_id DESC
        LIMIT $2
      `,
      [profileId, limit],
    );

    const rows: EpisodicFollowRow[] = [];
    for (const row of result.rows) {
      rows.push(await this.mapEpisodicFollowRow(client, row));
    }

    return rows;
  }

  async getEpisodicFollowByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<EpisodicFollowRow | null> {
    const identity = parseMediaKey(mediaKey);
    if (identity.mediaType !== 'show') {
      return null;
    }

    const titleContentId = await this.contentIdentityService.ensureContentId(client, identity);
    return this.getEpisodicFollowByContentId(client, profileId, titleContentId);
  }

  async getEpisodicFollowByContentId(client: DbClient, profileId: string, titleContentId: string): Promise<EpisodicFollowRow | null> {
    const result = await client.query(
      `
        SELECT
          projection.title_content_id,
          projection.title_media_key,
          projection.title_media_type,
          projection.title_provider,
          projection.title_provider_id,
          CASE
            WHEN projection.watchlist_present = true THEN 'watchlist'
            WHEN projection.rating_value IS NOT NULL THEN 'rating'
            ELSE 'watch_activity'
          END AS reason,
          COALESCE(
            projection.last_activity_at,
            projection.last_watched_at,
            projection.rated_at,
            projection.watchlist_updated_at
          ) AS last_interacted_at,
          metadata.next_episode_air_date,
          metadata.next_episode_media_key,
          metadata.next_episode_season_number,
          metadata.next_episode_episode_number,
          metadata.next_episode_absolute_episode_number,
          metadata.next_episode_title,
          metadata.metadata_refreshed_at,
          COALESCE(metadata.payload, '{}'::jsonb) AS payload
        FROM profile_title_projection projection
        LEFT JOIN profile_episodic_follow_state metadata
          ON metadata.profile_id = projection.profile_id
         AND metadata.title_content_id = projection.title_content_id
        WHERE projection.profile_id = $1::uuid
          AND projection.title_content_id = $2::uuid
          AND projection.title_media_type = 'show'
          AND (
            projection.has_in_progress = true
            OR projection.effective_watched = true
            OR projection.watchlist_present = true
            OR projection.rating_value IS NOT NULL
          )
        LIMIT 1
      `,
      [profileId, titleContentId],
    );

    const row = result.rows[0];
    return row ? this.mapEpisodicFollowRow(client, row) : null;
  }

  private async resolveTitleIdentity(client: DbClient, titleContentId: string, fallback: MediaIdentity): Promise<MediaIdentity> {
    const reference = await this.contentIdentityService.resolveContentReference(client, titleContentId).catch(() => null);
    if (reference && 'mediaIdentity' in reference) {
      return reference.mediaIdentity;
    }
    return inferMediaIdentity({
      contentId: titleContentId,
      mediaKey: fallback.mediaKey,
      mediaType: fallback.mediaType,
      provider: fallback.provider,
      providerId: fallback.providerId,
      tmdbId: fallback.tmdbId,
      showTmdbId: fallback.showTmdbId,
    });
  }

  private async mapEpisodicFollowRow(client: DbClient, row: Record<string, unknown>): Promise<EpisodicFollowRow> {
    const seriesMediaKey = String(row.title_media_key);
    const parsed = parseMediaKey(seriesMediaKey);
    const titleContentId = String(row.title_content_id);
    const identity = await this.resolveTitleIdentity(client, titleContentId, parsed);
    return {
      titleContentId,
      seriesMediaKey,
      seriesMediaType: 'show',
      provider: identity.provider ?? String(row.title_provider),
      providerId: identity.providerId ?? String(row.title_provider_id),
      reason: typeof row.reason === 'string' ? row.reason : 'watch_activity',
      lastInteractedAt: requireDbIsoString(row.last_interacted_at as Date | string | null | undefined, 'profile_title_projection.last_interacted_at'),
      nextEpisodeAirDate: toDbIsoString(row.next_episode_air_date as Date | string | null | undefined, 'profile_episodic_follow_state.next_episode_air_date'),
      nextEpisodeMediaKey: typeof row.next_episode_media_key === 'string' ? row.next_episode_media_key : null,
      nextEpisodeSeasonNumber: row.next_episode_season_number === null ? null : Number(row.next_episode_season_number),
      nextEpisodeEpisodeNumber: row.next_episode_episode_number === null ? null : Number(row.next_episode_episode_number),
      nextEpisodeAbsoluteEpisodeNumber: row.next_episode_absolute_episode_number === null ? null : Number(row.next_episode_absolute_episode_number),
      nextEpisodeTitle: typeof row.next_episode_title === 'string' ? row.next_episode_title : null,
      metadataRefreshedAt: toDbIsoString(row.metadata_refreshed_at as Date | string | null | undefined, 'profile_episodic_follow_state.metadata_refreshed_at'),
      payload: (row.payload as Record<string, unknown> | undefined) ?? {},
      showTmdbId: showTmdbIdForIdentity(identity),
    };
  }
}
