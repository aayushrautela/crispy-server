import { env } from '../../config/env.js';
import type { ServiceOutboxEventRecord } from './service-outbox.repo.js';

export type RecommenderOutboxDispatchResult = {
  status: number;
};

export class RecommenderOutboxClient {
  constructor(
    private readonly baseUrl = env.recommenderInternalBaseUrl,
    private readonly token = env.mainToRecommenderServiceToken,
    private readonly timeoutMs = 10000,
  ) {}

  async postEvent(event: ServiceOutboxEventRecord): Promise<RecommenderOutboxDispatchResult> {
    if (!this.baseUrl) {
      throw new Error('RECOMMENDER_INTERNAL_BASE_URL is required when outbox dispatcher is enabled');
    }

    if (!this.token) {
      throw new Error('MAIN_TO_RECOMMENDER_SERVICE_TOKEN is required when outbox dispatcher is enabled');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(event.correlationId ? { 'X-Correlation-Id': event.correlationId } : {}),
        },
        body: JSON.stringify({
          eventId: event.id,
          eventType: event.eventType,
          eventVersion: event.eventVersion,
          occurredAt: event.occurredAt,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          userId: event.userId,
          profileId: event.profileId,
          source: 'crispy-server',
          correlationId: event.correlationId,
          payload: event.payload,
        }),
        signal: controller.signal,
      });

      return { status: response.status };
    } finally {
      clearTimeout(timeout);
    }
  }
}
