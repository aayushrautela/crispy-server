import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor } from '../auth/auth.types.js';
import { RecommendationConsumerRepository } from './recommendation-consumer.repo.js';
import type { RecommendationConsumerRecord } from './recommendation-consumer.types.js';

export class RecommendationConsumerService {
  constructor(private readonly consumerRepository = new RecommendationConsumerRepository()) {}

  async ensureInternalDefault(): Promise<RecommendationConsumerRecord> {
    return this.ensureInternalServiceConsumer(null);
  }

  async ensureInternalServiceConsumer(serviceId: string | null): Promise<RecommendationConsumerRecord> {
    const sourceKey = normalizeServiceSourceKey(serviceId);
    return withTransaction(async (client) => {
      return this.consumerRepository.findOrCreateInternal(client, {
        consumerKey: sourceKey === 'internal-default' ? 'internal-default' : `service:${sourceKey}`,
        displayName: sourceKey === 'internal-default'
          ? 'Crispy Internal Recommender'
          : `Internal Service ${serviceId}`,
        sourceKey,
      });
    });
  }

  async ensureForUser(userId: string, input: { displayName: string; sourceKey?: string | null }): Promise<RecommendationConsumerRecord> {
    return withTransaction(async (client) => {
      return this.consumerRepository.findOrCreateForUser(client, {
        userId,
        displayName: input.displayName,
        sourceKey: input.sourceKey ?? null,
      });
    });
  }

  async listForUser(userId: string): Promise<RecommendationConsumerRecord[]> {
    return withTransaction(async (client) => this.consumerRepository.listActiveForUser(client, userId));
  }

  async revokeForUser(userId: string, consumerId: string): Promise<void> {
    return withTransaction(async (client) => {
      const updated = await this.consumerRepository.revokeForUser(client, userId, consumerId);
      if (!updated) {
        throw new HttpError(404, 'Recommendation consumer not found.');
      }
    });
  }

  async resolveForActor(actor: AuthActor, preferredSourceKey?: string | null): Promise<RecommendationConsumerRecord> {
    if (actor.consumerId) {
      return withTransaction(async (client) => {
        const consumer = await this.consumerRepository.findById(client, actor.consumerId!);
        if (!consumer || consumer.status !== 'active') {
          throw new HttpError(403, 'Recommendation consumer not available.');
        }
        return consumer;
      });
    }

    if (actor.type === 'service') {
      return this.ensureInternalServiceConsumer(actor.serviceId);
    }

    if (!actor.appUserId) {
      throw new HttpError(403, 'User consumer required.');
    }

    return withTransaction(async (client) => {
      if (preferredSourceKey) {
        const existing = await this.consumerRepository.findActiveForUserBySourceKey(client, actor.appUserId!, preferredSourceKey);
        if (existing) {
          return existing;
        }
      }

      const consumers = await this.consumerRepository.listActiveForUser(client, actor.appUserId!);
      if (consumers[0]) {
        return consumers[0];
      }

      return this.consumerRepository.findOrCreateForUser(client, {
        userId: actor.appUserId!,
        displayName: 'My Recommender',
        sourceKey: preferredSourceKey ?? 'user-default',
      });
    });
  }
}

function normalizeServiceSourceKey(serviceId: string | null): string {
  if (!serviceId?.trim()) {
    return 'internal-default';
  }

  const normalized = serviceId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return normalized || 'internal-default';
}
