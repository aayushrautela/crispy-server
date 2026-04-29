import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString } from '../../../lib/time.js';
import type { IntegrationOutboxEvent } from './integration-outbox.types.js';

function mapOutboxEvent(row: Record<string, unknown>): IntegrationOutboxEvent {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    accountId: String(row.account_id),
    profileId: typeof row.profile_id === 'string' ? row.profile_id : null,
    eventType: String(row.event_type),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    eventVersion: Number(row.event_version),
    occurredAt: requireDbIsoString(row.occurred_at as Date | string | null | undefined, 'integration_outbox_events.occurred_at'),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    idempotencyKey: typeof row.idempotency_key === 'string' ? row.idempotency_key : null,
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'integration_outbox_events.created_at'),
  };
}

export type AppendIntegrationOutboxEventInput = {
  accountId: string;
  profileId?: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  eventVersion?: number;
  occurredAt?: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
};

export class IntegrationOutboxRepository {
  async append(client: DbClient, input: AppendIntegrationOutboxEventInput): Promise<void> {
    await client.query(
      `
        INSERT INTO integration_outbox_events (
          account_id, profile_id, event_type, aggregate_type, aggregate_id, event_version, occurred_at, payload, idempotency_key
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8::jsonb, $9)
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      `,
      [
        input.accountId,
        input.profileId ?? null,
        input.eventType,
        input.aggregateType,
        input.aggregateId,
        input.eventVersion ?? 1,
        input.occurredAt ?? null,
        JSON.stringify(input.payload),
        input.idempotencyKey ?? null,
      ],
    );
  }

  async listForAccount(
    client: DbClient,
    accountId: string,
    params: { afterId?: string | null; limit: number },
  ): Promise<IntegrationOutboxEvent[]> {
    const result = await client.query(
      `
        SELECT
          id,
          event_id,
          account_id,
          profile_id,
          event_type,
          aggregate_type,
          aggregate_id,
          event_version,
          occurred_at,
          payload,
          idempotency_key,
          created_at
        FROM integration_outbox_events
        WHERE account_id = $1::uuid
          AND ($2::bigint IS NULL OR id > $2::bigint)
        ORDER BY id ASC
        LIMIT $3
      `,
      [accountId, params.afterId ?? null, params.limit],
    );

    return result.rows.map(mapOutboxEvent);
  }
}
