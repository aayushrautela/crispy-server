import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor } from '../auth/auth.types.js';
import { RecommendationConsumerService } from './recommendation-consumer.service.js';
import { RecommendationWorkStateRepository } from './recommendation-work-state.repo.js';
import type {
  CompleteRecommendationLeaseInput,
  RecommendationWorkItem,
  RenewRecommendationLeaseInput,
} from './recommendation-work.types.js';

export class RecommendationWorkService {
  constructor(
    private readonly consumerService = new RecommendationConsumerService(),
    private readonly workStateRepository = new RecommendationWorkStateRepository(),
  ) {}

  async claimWork(actor: AuthActor, input: {
    workerId: string;
    limit: number;
    leaseTtlSeconds: number;
    sourceKey?: string | null;
  }): Promise<{ consumerId: string; sourceKey: string; items: RecommendationWorkItem[] }> {
    const consumer = await this.consumerService.resolveForActor(actor, input.sourceKey ?? null);

    const items = await withTransaction(async (client) => {
      return this.workStateRepository.claimPendingProfiles(client, {
        consumerId: consumer.id,
        sourceKey: consumer.sourceKey,
        workerId: input.workerId,
        limit: input.limit,
        leaseTtlSeconds: input.leaseTtlSeconds,
        restrictToUserId: actor.type === 'service' ? null : actor.appUserId,
      });
    });

    return {
      consumerId: consumer.id,
      sourceKey: consumer.sourceKey,
      items,
    };
  }

  async renewLease(actor: AuthActor, input: RenewRecommendationLeaseInput & { sourceKey?: string | null }) {
    const consumer = await this.consumerService.resolveForActor(actor, input.sourceKey ?? null);
    this.ensureConsumerMatch(consumer.id, input.consumerId);

    return withTransaction(async (client) => {
      return this.workStateRepository.renewLease(client, {
        consumerId: consumer.id,
        profileId: input.profileId,
        leaseId: input.leaseId,
        workerId: input.workerId,
        leaseTtlSeconds: input.leaseTtlSeconds,
      });
    });
  }

  async completeLease(actor: AuthActor, input: CompleteRecommendationLeaseInput & { sourceKey?: string | null }) {
    const consumer = await this.consumerService.resolveForActor(actor, input.sourceKey ?? null);
    this.ensureConsumerMatch(consumer.id, input.consumerId);

    return withTransaction(async (client) => {
      return this.workStateRepository.completeLease(client, {
        consumerId: consumer.id,
        profileId: input.profileId,
        leaseId: input.leaseId,
        workerId: input.workerId,
      });
    });
  }

  private ensureConsumerMatch(expectedConsumerId: string, providedConsumerId: string): void {
    if (expectedConsumerId !== providedConsumerId) {
      throw new HttpError(403, 'Consumer mismatch.');
    }
  }
}
