import type { DbClient } from '../../../lib/db.js';
import { IntegrationOutboxRepository } from './integration-outbox.repo.js';
import type { IntegrationOutboxEvent } from './integration-outbox.types.js';
import { decodeIntegrationChangeCursor, encodeIntegrationChangeCursor } from './integration-change-cursor.js';

export type IntegrationChangesPage = {
  events: IntegrationOutboxEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};

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

export class IntegrationOutboxService {
  constructor(private readonly outboxRepo = new IntegrationOutboxRepository()) {}

  async appendChange(client: DbClient, input: AppendIntegrationOutboxEventInput): Promise<void> {
    await this.outboxRepo.append(client, input);
  }

  async listChanges(client: DbClient, accountId: string, params: { cursor?: string | null; limit: number }): Promise<IntegrationChangesPage> {
    const cursor = decodeIntegrationChangeCursor(params.cursor);
    const events = await this.outboxRepo.listForAccount(client, accountId, {
      afterId: cursor?.lastId ?? null,
      limit: params.limit + 1,
    });

    const hasMore = events.length > params.limit;
    const items = events.slice(0, params.limit);
    const lastEvent = items.at(-1);

    return {
      events: items,
      nextCursor: hasMore && lastEvent ? encodeIntegrationChangeCursor({ lastId: lastEvent.id }) : null,
      hasMore,
    };
  }
}
