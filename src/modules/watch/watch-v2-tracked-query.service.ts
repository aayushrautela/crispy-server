import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { inferMediaIdentity, parseMediaKey, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';

export type TrackedTitleRow = {
  titleContentId: string;
  trackedMediaKey: string;
  trackedMediaType: 'show' | 'anime';
  provider: string;
  providerId: string;
  reason: string;
  lastInteractedAt: string;
  nextEpisodeAirDate: string | null;
  metadataRefreshedAt: string | null;
  payload: Record<string, unknown>;
  showTmdbId: number | null;
};

export class WatchV2TrackedQueryService {
  constructor(private readonly contentIdentityService = new ContentIdentityService()) {}

  async listTrackedTitles(client: DbClient, profileId: string, limit = 100): Promise<TrackedTitleRow[]> {
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
          metadata.metadata_refreshed_at,
          COALESCE(metadata.payload, '{}'::jsonb) AS payload
        FROM profile_title_projection projection
        LEFT JOIN profile_tracked_title_state metadata
          ON metadata.profile_id = projection.profile_id
         AND metadata.title_content_id = projection.title_content_id
        WHERE projection.profile_id = $1::uuid
          AND projection.title_media_type IN ('show', 'anime')
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

    const rows: TrackedTitleRow[] = [];
    for (const row of result.rows) {
      const trackedMediaKey = String(row.title_media_key);
      const parsed = parseMediaKey(trackedMediaKey);
      const titleContentId = String(row.title_content_id);
      const identity = await this.resolveTitleIdentity(client, titleContentId, parsed);
      rows.push({
        titleContentId,
        trackedMediaKey,
        trackedMediaType: parsed.mediaType === 'anime' ? 'anime' : 'show',
        provider: identity.provider ?? String(row.title_provider),
        providerId: identity.providerId ?? String(row.title_provider_id),
        reason: typeof row.reason === 'string' ? row.reason : 'watch_activity',
        lastInteractedAt: requireDbIsoString(row.last_interacted_at as Date | string | null | undefined, 'profile_title_projection.last_interacted_at'),
        nextEpisodeAirDate: toDbIsoString(row.next_episode_air_date as Date | string | null | undefined, 'profile_tracked_title_state.next_episode_air_date'),
        metadataRefreshedAt: toDbIsoString(row.metadata_refreshed_at as Date | string | null | undefined, 'profile_tracked_title_state.metadata_refreshed_at'),
        payload: (row.payload as Record<string, unknown> | undefined) ?? {},
        showTmdbId: showTmdbIdForIdentity(identity),
      });
    }

    return rows;
  }

  async getTrackedTitleByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<TrackedTitleRow | null> {
    const identity = parseMediaKey(mediaKey);
    if (identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
      return null;
    }

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
          metadata.metadata_refreshed_at,
          COALESCE(metadata.payload, '{}'::jsonb) AS payload
        FROM profile_title_projection projection
        LEFT JOIN profile_tracked_title_state metadata
          ON metadata.profile_id = projection.profile_id
         AND metadata.title_content_id = projection.title_content_id
        WHERE projection.profile_id = $1::uuid
          AND projection.title_media_key = $2
          AND projection.title_media_type IN ('show', 'anime')
        LIMIT 1
      `,
      [profileId, mediaKey],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const trackedRows = await this.listTrackedTitles(client, profileId, 1_000_000);
    return trackedRows.find((entry) => entry.titleContentId === String(row.title_content_id)) ?? null;
  }

  async getTrackedTitleByContentId(client: DbClient, profileId: string, titleContentId: string): Promise<TrackedTitleRow | null> {
    const trackedRows = await this.listTrackedTitles(client, profileId, 1_000_000);
    return trackedRows.find((entry) => entry.titleContentId === titleContentId) ?? null;
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
}
