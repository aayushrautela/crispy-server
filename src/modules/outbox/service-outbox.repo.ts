import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';

export type ServiceOutboxEventStatus = 'pending' | 'processing' | 'dispatched' | 'failed';

export type ServiceOutboxEventRecord = {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  userId: string | null;
  profileId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  availableAt: string;
  status: ServiceOutboxEventStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lockedUntil: string | null;
  destination: string;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InsertServiceOutboxEventInput = {
  id: string;
  eventType: string;
  eventVersion?: number;
  aggregateType: string;
  aggregateId: string;
  userId?: string | null;
  profileId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: string;
  availableAt?: string;
  destination: string;
  correlationId?: string | null;
};

const serviceOutboxColumns = `
  id,
  event_type,
  event_version,
  aggregate_type,
  aggregate_id,
  user_id,
  profile_id,
  payload,
  occurred_at,
  available_at,
  status,
  attempt_count,
  last_attempt_at,
  next_attempt_at,
  locked_until,
  destination,
  correlation_id,
  created_at,
  updated_at
`;

function mapServiceOutboxEvent(row: Record<string, unknown>): ServiceOutboxEventRecord {
  return {
    id: String(row.id),
    eventType: String(row.event_type),
    eventVersion: Number(row.event_version),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    profileId: typeof row.profile_id === 'string' ? row.profile_id : null,
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    occurredAt: requireDbIsoString(row.occurred_at as Date | string | null | undefined, 'service_outbox_events.occurred_at'),
    availableAt: requireDbIsoString(row.available_at as Date | string | null | undefined, 'service_outbox_events.available_at'),
    status: String(row.status) as ServiceOutboxEventStatus,
    attemptCount: Number(row.attempt_count),
    lastAttemptAt: toDbIsoString(row.last_attempt_at as Date | string | null | undefined, 'service_outbox_events.last_attempt_at'),
    nextAttemptAt: toDbIsoString(row.next_attempt_at as Date | string | null | undefined, 'service_outbox_events.next_attempt_at'),
    lockedUntil: toDbIsoString(row.locked_until as Date | string | null | undefined, 'service_outbox_events.locked_until'),
    destination: String(row.destination),
    correlationId: typeof row.correlation_id === 'string' ? row.correlation_id : null,
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'service_outbox_events.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'service_outbox_events.updated_at'),
  };
}

export class ServiceOutboxRepository {
  async insert(client: DbClient, input: InsertServiceOutboxEventInput): Promise<ServiceOutboxEventRecord> {
    const result = await client.query(
      `
        INSERT INTO service_outbox_events (
          id,
          event_type,
          event_version,
          aggregate_type,
          aggregate_id,
          user_id,
          profile_id,
          payload,
          occurred_at,
          available_at,
          destination,
          correlation_id
        )
        VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::jsonb, COALESCE($9::timestamptz, now()), COALESCE($10::timestamptz, now()), $11, $12)
        RETURNING ${serviceOutboxColumns}
      `,
      [
        input.id,
        input.eventType,
        input.eventVersion ?? 1,
        input.aggregateType,
        input.aggregateId,
        input.userId ?? null,
        input.profileId ?? null,
        JSON.stringify(input.payload ?? {}),
        input.occurredAt ?? null,
        input.availableAt ?? null,
        input.destination,
        input.correlationId ?? null,
      ],
    );

    return mapServiceOutboxEvent(result.rows[0]);
  }

  async claimDuePending(client: DbClient, params: { limit: number; lockUntil: string; destination?: string | null }): Promise<ServiceOutboxEventRecord[]> {
    const result = await client.query(
      `
        WITH due AS (
          SELECT id
          FROM service_outbox_events
          WHERE status = 'pending'
            AND available_at <= now()
            AND ($1::text IS NULL OR destination = $1)
          ORDER BY available_at ASC, occurred_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE service_outbox_events events
        SET status = 'processing',
            attempt_count = events.attempt_count + 1,
            last_attempt_at = now(),
            locked_until = $3::timestamptz,
            updated_at = now()
        FROM due
        WHERE events.id = due.id
        RETURNING ${serviceOutboxColumns}
      `,
      [params.destination ?? null, params.limit, params.lockUntil],
    );

    return result.rows.map(mapServiceOutboxEvent);
  }

  async markDispatched(client: DbClient, id: string): Promise<ServiceOutboxEventRecord | null> {
    const result = await client.query(
      `
        UPDATE service_outbox_events
        SET status = 'dispatched',
            locked_until = NULL,
            updated_at = now()
        WHERE id = $1
          AND status = 'processing'
        RETURNING ${serviceOutboxColumns}
      `,
      [id],
    );

    return result.rows[0] ? mapServiceOutboxEvent(result.rows[0]) : null;
  }

  async markFailedForRetry(client: DbClient, params: { id: string; nextAttemptAt: string }): Promise<ServiceOutboxEventRecord | null> {
    const result = await client.query(
      `
        UPDATE service_outbox_events
        SET status = 'pending',
            available_at = $2::timestamptz,
            next_attempt_at = $2::timestamptz,
            locked_until = NULL,
            updated_at = now()
        WHERE id = $1
          AND status = 'processing'
        RETURNING ${serviceOutboxColumns}
      `,
      [params.id, params.nextAttemptAt],
    );

    return result.rows[0] ? mapServiceOutboxEvent(result.rows[0]) : null;
  }

  async markFailed(client: DbClient, id: string): Promise<ServiceOutboxEventRecord | null> {
    const result = await client.query(
      `
        UPDATE service_outbox_events
        SET status = 'failed',
            locked_until = NULL,
            updated_at = now()
        WHERE id = $1
          AND status = 'processing'
        RETURNING ${serviceOutboxColumns}
      `,
      [id],
    );

    return result.rows[0] ? mapServiceOutboxEvent(result.rows[0]) : null;
  }

  async releaseStaleProcessing(client: DbClient, limit: number): Promise<ServiceOutboxEventRecord[]> {
    const result = await client.query(
      `
        WITH stale AS (
          SELECT id
          FROM service_outbox_events
          WHERE status = 'processing'
            AND locked_until <= now()
          ORDER BY locked_until ASC, occurred_at ASC, id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE service_outbox_events events
        SET status = 'pending',
            available_at = now(),
            locked_until = NULL,
            updated_at = now()
        FROM stale
        WHERE events.id = stale.id
        RETURNING ${serviceOutboxColumns}
      `,
      [limit],
    );

    return result.rows.map(mapServiceOutboxEvent);
  }

  async queryForDiagnostics(client: DbClient, filters: {
    correlationId?: string | null;
    profileId?: string | null;
    reason?: string | null;
    status?: ServiceOutboxEventStatus | null;
    limit: number;
  }): Promise<ServiceOutboxEventRecord[]> {
    const conditions: string[] = ['event_type = $1'];
    const params: unknown[] = ['recommendation.recompute_requested'];
    let paramIndex = 2;

    if (filters.correlationId) {
      conditions.push(`correlation_id = $${paramIndex}`);
      params.push(filters.correlationId);
      paramIndex++;
    }

    if (filters.profileId) {
      conditions.push(`profile_id = $${paramIndex}::uuid`);
      params.push(filters.profileId);
      paramIndex++;
    }

    if (filters.reason) {
      conditions.push(`payload->>'reason' = $${paramIndex}`);
      params.push(filters.reason);
      paramIndex++;
    }

    if (filters.status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }

    params.push(filters.limit);

    const result = await client.query(
      `
        SELECT ${serviceOutboxColumns}
        FROM service_outbox_events
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${paramIndex}
      `,
      params,
    );

    return result.rows.map(mapServiceOutboxEvent);
  }
}
