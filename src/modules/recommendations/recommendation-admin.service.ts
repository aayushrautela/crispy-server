import { withTransaction, type DbClient } from '../../lib/db.js';
import {
  RecommendationConsumerRepository,
  type RecommendationConsumerAdminRecord,
} from './recommendation-consumer.repo.js';
import {
  RecommendationWorkStateRepository,
  type RecommendationBacklogSummaryRecord,
  type RecommendationLeaseDiagnosticRecord,
} from './recommendation-work-state.repo.js';
import {
  RecommendationEventOutboxRepository,
  type RecommendationEventOutboxAdminRecord,
  type RecommendationEventOutboxLagSummary,
} from './recommendation-event-outbox.repo.js';

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class RecommendationAdminService {
  constructor(
    private readonly consumerRepository = new RecommendationConsumerRepository(),
    private readonly workStateRepository = new RecommendationWorkStateRepository(),
    private readonly eventOutboxRepository = new RecommendationEventOutboxRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async listConsumers(limit = 100): Promise<{ consumers: RecommendationConsumerAdminRecord[] }> {
    return this.runInTransaction(async (client) => ({
      consumers: await this.consumerRepository.listAll(client, limit),
    }));
  }

  async getWorkState(limit = 100): Promise<{
    activeLeases: RecommendationLeaseDiagnosticRecord[];
    staleLeases: RecommendationLeaseDiagnosticRecord[];
    backlog: RecommendationBacklogSummaryRecord[];
  }> {
    return this.runInTransaction(async (client) => {
      const [activeLeases, staleLeases, backlog] = await Promise.all([
        this.workStateRepository.listActiveLeases(client, limit),
        this.workStateRepository.listStaleLeases(client, limit),
        this.workStateRepository.listBacklogSummaries(client, limit),
      ]);

      return { activeLeases, staleLeases, backlog };
    });
  }

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
