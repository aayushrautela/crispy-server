import type { DbClient } from '../../lib/db.js';

export type RecommendationEventOutboxRecord = {
  id: number;
  profileId: string;
  historyGeneration: number;
  eventType: string;
  mediaKey: string | null;
  mediaType: string | null;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
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
    tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
    showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
    seasonNumber: row.season_number === null ? null : Number(row.season_number),
    episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
    rating: row.rating === null ? null : Number(row.rating),
    occurredAt: String(row.occurred_at),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    createdAt: String(row.created_at),
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
    tmdbId?: number | null;
    showTmdbId?: number | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
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
          tmdb_id,
          show_tmdb_id,
          season_number,
          episode_number,
          rating,
          occurred_at,
          payload
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::jsonb)
        RETURNING id, profile_id, history_generation, event_type, media_key, media_type,
                  tmdb_id, show_tmdb_id, season_number, episode_number, rating,
                  occurred_at, payload, created_at
      `,
      [
        params.profileId,
        params.historyGeneration,
        params.eventType,
        params.mediaKey ?? null,
        params.mediaType ?? null,
        params.tmdbId ?? null,
        params.showTmdbId ?? null,
        params.seasonNumber ?? null,
        params.episodeNumber ?? null,
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
               tmdb_id, show_tmdb_id, season_number, episode_number, rating,
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
      deliveredAt: typeof row.delivered_at === 'string' ? row.delivered_at : null,
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
      oldestOccurredAt: typeof row.oldest_occurred_at === 'string' ? row.oldest_occurred_at : null,
      oldestCreatedAt: typeof row.oldest_created_at === 'string' ? row.oldest_created_at : null,
      newestCreatedAt: typeof row.newest_created_at === 'string' ? row.newest_created_at : null,
    };
  }
}
