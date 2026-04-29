import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString } from '../../../lib/time.js';
import type { MediaRef } from '../media-ref.types.js';

export type IntegrationHistoryItem = {
  id: string;
  mediaRef: MediaRef;
  status: 'in_progress' | 'watched' | 'watchlist';
  progress?: {
    positionSeconds: number | null;
    durationSeconds: number | null;
    progressPercent: number;
  };
  watchedAt?: string | null;
  addedAt?: string | null;
  lastActivityAt?: string | null;
  updatedAt: string;
  isDeleted: boolean;
};

export type IntegrationHistoryPage = {
  items: IntegrationHistoryItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

type HistoryCursor = {
  updatedAt: string;
  id: string;
};

function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

function decodeHistoryCursor(encoded: string | null | undefined): HistoryCursor | null {
  if (!encoded) {
    return null;
  }
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'updatedAt' in parsed &&
      'id' in parsed &&
      typeof parsed.updatedAt === 'string' &&
      typeof parsed.id === 'string'
    ) {
      return { updatedAt: parsed.updatedAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export class IntegrationHistoryService {
  async listHistory(
    client: DbClient,
    profileId: string,
    params: {
      cursor?: string | null;
      updatedSince?: string | null;
      limit: number;
      includeDeleted: boolean;
    },
  ): Promise<IntegrationHistoryPage> {
    const cursor = decodeHistoryCursor(params.cursor);

    // Query profile_title_projection for all watch states
    const result = await client.query(
      `
        SELECT
          title_content_id::text AS id,
          title_media_key AS media_key,
          title_media_type AS media_type,
          playback_provider,
          playback_provider_id,
          playback_parent_provider,
          playback_parent_provider_id,
          playback_season_number,
          playback_episode_number,
          playback_absolute_episode_number,
          has_in_progress,
          effective_watched,
          effective_watchlist,
          position_seconds,
          duration_seconds,
          progress_percent,
          last_watched_at,
          last_activity_at,
          updated_at,
          dismissed_at
        FROM profile_title_projection
        WHERE profile_id = $1::uuid
          AND (
            $2::timestamptz IS NULL
            OR updated_at >= $2::timestamptz
          )
          AND (
            $3::timestamptz IS NULL
            OR updated_at < $3::timestamptz
            OR (updated_at = $3::timestamptz AND title_content_id::text < $4)
          )
          AND (
            $5::boolean = true
            OR dismissed_at IS NULL
          )
        ORDER BY updated_at DESC, title_content_id DESC
        LIMIT $6
      `,
      [
        profileId,
        params.updatedSince ?? null,
        cursor?.updatedAt ?? null,
        cursor?.id ?? null,
        params.includeDeleted,
        params.limit + 1,
      ],
    );

    const hasMore = result.rows.length > params.limit;
    const rows = result.rows.slice(0, params.limit);

    const items: IntegrationHistoryItem[] = rows.map((row) => {
      const updatedAt = requireDbIsoString(row.updated_at as Date | string | null | undefined, 'profile_title_projection.updated_at');
      const isDeleted = row.dismissed_at !== null;

      // Determine primary status
      let status: 'in_progress' | 'watched' | 'watchlist';
      if (row.has_in_progress === true) {
        status = 'in_progress';
      } else if (row.effective_watched === true) {
        status = 'watched';
      } else if (row.effective_watchlist === true) {
        status = 'watchlist';
      } else {
        status = 'watched'; // fallback
      }

      const mediaRef: MediaRef = {
        mediaType: String(row.media_type) as 'movie' | 'series' | 'season' | 'episode',
      };

      // Add provider IDs if available
      if (row.playback_provider && row.playback_provider_id) {
        mediaRef.providerIds = {
          [String(row.playback_provider)]: String(row.playback_provider_id),
        };
      }

      // Add episode details if applicable
      if (row.media_type === 'episode' && row.playback_season_number !== null && row.playback_episode_number !== null) {
        mediaRef.seasonNumber = Number(row.playback_season_number);
        mediaRef.episodeNumber = Number(row.playback_episode_number);

        if (row.playback_parent_provider && row.playback_parent_provider_id) {
          mediaRef.series = {
            providerIds: {
              [String(row.playback_parent_provider)]: String(row.playback_parent_provider_id),
            },
          };
        }
      }

      const item: IntegrationHistoryItem = {
        id: String(row.id),
        mediaRef,
        status,
        updatedAt,
        isDeleted,
      };

      // Add progress for in_progress items
      if (status === 'in_progress') {
        item.progress = {
          positionSeconds: row.position_seconds !== null ? Number(row.position_seconds) : null,
          durationSeconds: row.duration_seconds !== null ? Number(row.duration_seconds) : null,
          progressPercent: Number(row.progress_percent ?? 0),
        };
        item.lastActivityAt = row.last_activity_at
          ? requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'profile_title_projection.last_activity_at')
          : null;
      }

      // Add watchedAt for watched items
      if (status === 'watched' && row.last_watched_at) {
        item.watchedAt = requireDbIsoString(row.last_watched_at as Date | string | null | undefined, 'profile_title_projection.last_watched_at');
      }

      // Add watchlist addedAt - we need to query profile_watchlist_state for this
      // For now, use updatedAt as fallback
      if (status === 'watchlist') {
        item.addedAt = updatedAt;
      }

      return item;
    });

    const lastItem = items.at(-1);

    return {
      items,
      nextCursor: hasMore && lastItem ? encodeHistoryCursor({ updatedAt: lastItem.updatedAt, id: lastItem.id }) : null,
      hasMore,
    };
  }
}
