import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';

export type RecommendationEventOutboxRecord = {
  id: number;
  profileId: string;
  historyGeneration: number;
  eventType: string;
  mediaKey: string | null;
  mediaType: string | null;
  provider: string | null;
  providerId: string | null;
  parentProvider: string | null;
  parentProviderId: string | null;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  rating: number | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type RecommendationEventOutboxAdminRecord = RecommendationEventOutboxRecord & {
  deliveredAt: string | null;
};

export type RecommendationEventOutboxLagSummary = {
  undeliveredCount: number;
  oldestOccurredAt: string | null;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
};

function mapOutbox(row: Record<string, unknown>): RecommendationEventOutboxRecord {
  return {
    id: Number(row.id),
    profileId: String(row.profile_id),
    historyGeneration: Number(row.history_generation),
    eventType: String(row.event_type),
    mediaKey: typeof row.media_key === 'string' ? row.media_key : null,
    mediaType: typeof row.media_type === 'string' ? row.media_type : null,
    provider: typeof row.provider === 'string' ? row.provider : null,
    providerId: typeof row.provider_id === 'string' ? row.provider_id : null,
    parentProvider: typeof row.parent_provider === 'string' ? row.parent_provider : null,
    parentProviderId: typeof row.parent_provider_id === 'string' ? row.parent_provider_id : null,
    tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
    showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
    seasonNumber: row.season_number === null ? null : Number(row.season_number),
    episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
    absoluteEpisodeNumber: row.absolute_episode_number === null ? null : Number(row.absolute_episode_number),
    rating: row.rating === null ? null : Number(row.rating),
    occurredAt: requireDbIsoString(row.occurred_at as Date | string | null | undefined, 'recommendation_event_outbox.occurred_at'),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'recommendation_event_outbox.created_at'),
  };
}

export class RecommendationEventOutboxRepository {
  async clearForProfile(client: DbClient, profileId: string): Promise<void> {
    await client.query(`DELETE FROM recommendation_event_outbox WHERE profile_id = $1::uuid`, [profileId]);
  }

  async append(client: DbClient, params: {
    profileId: string;
    historyGeneration: number;
    eventType: string;
    mediaKey?: string | null;
    mediaType?: string | null;
    provider?: string | null;
    providerId?: string | null;
    parentProvider?: string | null;
    parentProviderId?: string | null;
    tmdbId?: number | null;
    showTmdbId?: number | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    absoluteEpisodeNumber?: number | null;
    rating?: number | null;
    occurredAt: string;
    payload?: Record<string, unknown>;
  }): Promise<RecommendationEventOutboxRecord> {
    const result = await client.query(
      `
        INSERT INTO recommendation_event_outbox (
          profile_id,
          history_generation,
          event_type,
          media_key,
          media_type,
          provider,
          provider_id,
          parent_provider,
          parent_provider_id,
          tmdb_id,
          show_tmdb_id,
          season_number,
          episode_number,
          absolute_episode_number,
          rating,
          occurred_at,
          payload
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::timestamptz, $17::jsonb)
        RETURNING id, profile_id, history_generation, event_type, media_key, media_type,
                  provider, provider_id, parent_provider, parent_provider_id,
                  tmdb_id, show_tmdb_id, season_number, episode_number, absolute_episode_number, rating,
                  occurred_at, payload, created_at
      `,
      [
        params.profileId,
        params.historyGeneration,
        params.eventType,
        params.mediaKey ?? null,
        params.mediaType ?? null,
        params.provider ?? null,
        params.providerId ?? null,
        params.parentProvider ?? null,
        params.parentProviderId ?? null,
        params.tmdbId ?? null,
        params.showTmdbId ?? null,
        params.seasonNumber ?? null,
        params.episodeNumber ?? null,
        params.absoluteEpisodeNumber ?? null,
        params.rating ?? null,
        params.occurredAt,
        JSON.stringify(params.payload ?? {}),
      ],
    );
    return mapOutbox(result.rows[0]);
  }

  async listUndelivered(client: DbClient, limit: number): Promise<RecommendationEventOutboxAdminRecord[]> {
    const result = await client.query(
      `
        SELECT id, profile_id, history_generation, event_type, media_key, media_type,
               provider, provider_id, parent_provider, parent_provider_id,
               tmdb_id, show_tmdb_id, season_number, episode_number, absolute_episode_number, rating,
               occurred_at, payload, created_at, delivered_at
        FROM recommendation_event_outbox
        WHERE delivered_at IS NULL
        ORDER BY occurred_at ASC, id ASC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      ...mapOutbox(row),
      deliveredAt: toDbIsoString(row.delivered_at as Date | string | null | undefined, 'recommendation_event_outbox.delivered_at'),
    }));
  }

  async getLagSummary(client: DbClient): Promise<RecommendationEventOutboxLagSummary> {
    const result = await client.query(
      `
        SELECT COUNT(*)::integer AS undelivered_count,
               MIN(occurred_at) AS oldest_occurred_at,
               MIN(created_at) AS oldest_created_at,
               MAX(created_at) AS newest_created_at
        FROM recommendation_event_outbox
        WHERE delivered_at IS NULL
      `,
    );

    const row = result.rows[0] ?? {};
    return {
      undeliveredCount: Number(row.undelivered_count ?? 0),
      oldestOccurredAt: toDbIsoString(row.oldest_occurred_at as Date | string | null | undefined, 'recommendation_event_outbox.oldest_occurred_at'),
      oldestCreatedAt: toDbIsoString(row.oldest_created_at as Date | string | null | undefined, 'recommendation_event_outbox.oldest_created_at'),
      newestCreatedAt: toDbIsoString(row.newest_created_at as Date | string | null | undefined, 'recommendation_event_outbox.newest_created_at'),
    };
  }
}
