export type IntegrationOutboxEvent = {
  id: string;
  eventId: string;
  accountId: string;
  profileId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  eventVersion: number;
  occurredAt: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  createdAt: string;
};
