import { withTransaction, type DbClient } from '../../lib/db.js';
import {
  RecommendationEventOutboxRepository,
  type RecommendationEventOutboxAdminRecord,
  type RecommendationEventOutboxLagSummary,
} from './recommendation-event-outbox.repo.js';

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class RecommendationAdminService {
  constructor(
    private readonly eventOutboxRepository = new RecommendationEventOutboxRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getOutbox(limit = 100): Promise<{
    lag: RecommendationEventOutboxLagSummary;
    undelivered: RecommendationEventOutboxAdminRecord[];
  }> {
    return this.runInTransaction(async (client) => {
      const [lag, undelivered] = await Promise.all([
        this.eventOutboxRepository.getLagSummary(client),
        this.eventOutboxRepository.listUndelivered(client, limit),
      ]);

      return { lag, undelivered };
    });
  }
}
