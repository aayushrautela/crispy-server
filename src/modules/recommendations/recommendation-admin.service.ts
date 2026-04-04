import { withTransaction, type DbClient } from '../../lib/db.js';
import {
  RecommendationEventOutboxRepository,
  type RecommendationEventOutboxAdminRecord,
  type RecommendationEventOutboxLagSummary,
} from './recommendation-event-outbox.repo.js';
import {
  RecommendationGenerationJobsRepository,
  type RecommendationGenerationJobLagSummary,
  type RecommendationGenerationJobRecord,
} from './recommendation-generation-jobs.repo.js';

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class RecommendationAdminService {
  constructor(
    private readonly eventOutboxRepository = new RecommendationEventOutboxRepository(),
    private readonly generationJobsRepository = new RecommendationGenerationJobsRepository(),
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

  async getGenerationJobs(limit = 100): Promise<{
    lag: RecommendationGenerationJobLagSummary;
    jobs: RecommendationGenerationJobRecord[];
  }> {
    return this.runInTransaction(async (client) => {
      const [lag, jobs] = await Promise.all([
        this.generationJobsRepository.getLagSummary(client),
        this.generationJobsRepository.listRecent(client, limit),
      ]);

      return { lag, jobs };
    });
  }

  async getGenerationJob(jobId: string): Promise<{ job: RecommendationGenerationJobRecord | null }> {
    return this.runInTransaction(async (client) => ({
      job: await this.generationJobsRepository.findById(client, jobId),
    }));
  }
}
