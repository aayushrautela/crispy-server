import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type { RecommendationConsumerOwnerKind, RecommendationConsumerRecord } from './recommendation-consumer.types.js';

export type RecommendationConsumerAdminRecord = RecommendationConsumerRecord & {
  activeLeaseCount: number;
  trackedProfileCount: number;
  latestWorkStateUpdatedAt: string | null;
};

function mapConsumer(row: Record<string, unknown>): RecommendationConsumerRecord {
  return {
    id: String(row.id),
    consumerKey: String(row.consumer_key),
    ownerKind: String(row.owner_kind) as RecommendationConsumerOwnerKind,
    ownerUserId: typeof row.owner_user_id === 'string' ? row.owner_user_id : null,
    displayName: String(row.display_name),
    sourceKey: String(row.source_key),
    isInternal: Boolean(row.is_internal),
    status: String(row.status) as 'active' | 'revoked',
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'recommendation_consumers.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'recommendation_consumers.updated_at'),
  };
}

export class RecommendationConsumerRepository {
  async findById(client: DbClient, consumerId: string): Promise<RecommendationConsumerRecord | null> {
    const result = await client.query(
      `
        SELECT id, consumer_key, owner_kind, owner_user_id, display_name, source_key,
               is_internal, status, created_at, updated_at
        FROM recommendation_consumers
        WHERE id = $1::uuid
      `,
      [consumerId],
    );
    return result.rows[0] ? mapConsumer(result.rows[0]) : null;
  }

  async findByConsumerKey(client: DbClient, consumerKey: string): Promise<RecommendationConsumerRecord | null> {
    const result = await client.query(
      `
        SELECT id, consumer_key, owner_kind, owner_user_id, display_name, source_key,
               is_internal, status, created_at, updated_at
        FROM recommendation_consumers
        WHERE consumer_key = $1
      `,
      [consumerKey],
    );
    return result.rows[0] ? mapConsumer(result.rows[0]) : null;
  }

  async findActiveForUserBySourceKey(client: DbClient, userId: string, sourceKey: string): Promise<RecommendationConsumerRecord | null> {
    const result = await client.query(
      `
        SELECT id, consumer_key, owner_kind, owner_user_id, display_name, source_key,
               is_internal, status, created_at, updated_at
        FROM recommendation_consumers
        WHERE owner_user_id = $1::uuid
          AND source_key = $2
          AND status = 'active'
      `,
      [userId, sourceKey],
    );
    return result.rows[0] ? mapConsumer(result.rows[0]) : null;
  }

  async listActiveForUser(client: DbClient, userId: string): Promise<RecommendationConsumerRecord[]> {
    const result = await client.query(
      `
        SELECT id, consumer_key, owner_kind, owner_user_id, display_name, source_key,
               is_internal, status, created_at, updated_at
        FROM recommendation_consumers
        WHERE owner_user_id = $1::uuid
          AND status = 'active'
        ORDER BY created_at ASC
      `,
      [userId],
    );
    return result.rows.map((row) => mapConsumer(row));
  }

  async listAll(client: DbClient, limit: number): Promise<RecommendationConsumerAdminRecord[]> {
    const result = await client.query(
      `
        SELECT rc.id, rc.consumer_key, rc.owner_kind, rc.owner_user_id, rc.display_name, rc.source_key,
               rc.is_internal, rc.status, rc.created_at, rc.updated_at,
               COUNT(rpws.profile_id)::integer AS tracked_profile_count,
               COUNT(*) FILTER (
                 WHERE rpws.lease_id IS NOT NULL
                   AND rpws.lease_expires_at IS NOT NULL
                   AND rpws.lease_expires_at >= now()
               )::integer AS active_lease_count,
               MAX(rpws.updated_at) AS latest_work_state_updated_at
        FROM recommendation_consumers rc
        LEFT JOIN recommendation_profile_work_state rpws ON rpws.consumer_id = rc.id
        GROUP BY rc.id
        ORDER BY rc.updated_at DESC, rc.created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      ...mapConsumer(row),
      activeLeaseCount: Number(row.active_lease_count ?? 0),
      trackedProfileCount: Number(row.tracked_profile_count ?? 0),
      latestWorkStateUpdatedAt: toDbIsoString(row.latest_work_state_updated_at as Date | string | null | undefined, 'recommendation_profile_work_state.latest_work_state_updated_at'),
    }));
  }

  async findOrCreateInternal(client: DbClient, params: {
    consumerKey: string;
    displayName: string;
    sourceKey: string;
  }): Promise<RecommendationConsumerRecord> {
    const result = await client.query(
      `
        INSERT INTO recommendation_consumers (
          consumer_key,
          owner_kind,
          owner_user_id,
          display_name,
          source_key,
          is_internal,
          status
        )
        VALUES ($1, 'service', NULL, $2, $3, true, 'active')
        ON CONFLICT (consumer_key)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          source_key = EXCLUDED.source_key,
          is_internal = true,
          status = 'active',
          updated_at = now()
        RETURNING id, consumer_key, owner_kind, owner_user_id, display_name, source_key,
                  is_internal, status, created_at, updated_at
      `,
      [params.consumerKey, params.displayName, params.sourceKey],
    );
    return mapConsumer(result.rows[0]);
  }

  async findOrCreateForUser(client: DbClient, params: {
    userId: string;
    displayName: string;
    sourceKey?: string | null;
    consumerKey?: string | null;
  }): Promise<RecommendationConsumerRecord> {
    const sourceKey = normalizeSourceKey(params.sourceKey ?? params.displayName);
    const consumerKey = params.consumerKey?.trim() || `user:${params.userId}:${sourceKey}`;
    const result = await client.query(
      `
        INSERT INTO recommendation_consumers (
          consumer_key,
          owner_kind,
          owner_user_id,
          display_name,
          source_key,
          is_internal,
          status
        )
        VALUES ($1, 'user', $2::uuid, $3, $4, false, 'active')
        ON CONFLICT (consumer_key)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          source_key = EXCLUDED.source_key,
          status = 'active',
          updated_at = now()
        RETURNING id, consumer_key, owner_kind, owner_user_id, display_name, source_key,
                  is_internal, status, created_at, updated_at
      `,
      [consumerKey, params.userId, params.displayName, sourceKey],
    );
    return mapConsumer(result.rows[0]);
  }

  async revokeForUser(client: DbClient, userId: string, consumerId: string): Promise<boolean> {
    const result = await client.query(
      `
        UPDATE recommendation_consumers
        SET status = 'revoked', updated_at = now()
        WHERE id = $1::uuid
          AND owner_user_id = $2::uuid
          AND is_internal = false
      `,
      [consumerId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function normalizeSourceKey(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return cleaned || `consumer-${randomUUID().slice(0, 8)}`;
}
