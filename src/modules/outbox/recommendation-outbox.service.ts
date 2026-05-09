import { randomUUID } from 'crypto';
import type { DbClient } from '../../lib/db.js';
import { ServiceOutboxRepository } from './service-outbox.repo.js';

export type RecommendationRecomputeReason =
  | 'watch_history_changed'
  | 'rating_changed'
  | 'watchlist_changed'
  | 'playback_progress_changed'
  | 'profile_created'
  | 'profile_settings_changed';

export type AppendRecommendationRecomputeRequestedInput = {
  userId: string;
  profileId: string;
  reason: RecommendationRecomputeReason;
  occurredAt?: string;
  correlationId?: string | null;
};

export class RecommendationOutboxService {
  constructor(private readonly serviceOutboxRepository = new ServiceOutboxRepository()) {}

  async appendRecomputeRequested(client: DbClient, input: AppendRecommendationRecomputeRequestedInput): Promise<void> {
    await this.serviceOutboxRepository.insert(client, {
      id: randomUUID(),
      eventType: 'recommendation.recompute_requested',
      eventVersion: 1,
      aggregateType: 'profile',
      aggregateId: input.profileId,
      userId: input.userId,
      profileId: input.profileId,
      payload: {
        reason: input.reason,
      },
      occurredAt: input.occurredAt,
      destination: 'recommender',
      correlationId: input.correlationId,
    });
  }
}
