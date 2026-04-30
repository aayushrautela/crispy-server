import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { Clock } from './clock.js';
import type {
  CreateRecommendationBatchInput,
  RecommendationBatch,
  UpdateRecommendationBatchInput,
} from './recommendation-batch.types.js';
import type { RecommendationBatchRepo } from './recommendation-batch.repo.js';
import type { RecommendationRunRepo } from './recommendation-run.repo.js';

export interface RecommendationBatchService {
  createBatch(input: CreateRecommendationBatchInput): Promise<{ batch: RecommendationBatch }>;
  updateBatch(input: UpdateRecommendationBatchInput): Promise<{ batch: RecommendationBatch }>;
}

export class DefaultRecommendationBatchService implements RecommendationBatchService {
  constructor(
    private readonly deps: {
      batchRepo: RecommendationBatchRepo;
      runRepo: RecommendationRunRepo;
      appAuthorizationService: AppAuthorizationService;
      appAuditRepo: AppAuditRepo;
      clock: Clock;
    },
  ) {}

  async createBatch(input: CreateRecommendationBatchInput): Promise<{ batch: RecommendationBatch }> {
    const { principal, runId, request } = input;

    this.deps.appAuthorizationService.requireScope({ principal, scope: 'recommendations:batches:write' });

    const run = await this.deps.runRepo.getRun({ appId: principal.appId, runId });
    if (!run) {
      throw new Error('recommendation_run_not_found');
    }

    const now = this.deps.clock.now();
    const batch = await this.deps.batchRepo.createBatch({
      appId: principal.appId,
      runId,
      snapshotId: request.snapshotId ?? null,
      status: 'leased',
      items: request.items,
      leaseSeconds: request.leaseSeconds ?? 300,
      createdAt: now,
    });

    await this.deps.appAuditRepo.insert({
      appId: principal.appId,
      keyId: principal.keyId,
      action: 'recommendation_batch_created',
      runId,
      batchId: batch.batchId,
      resourceType: 'recommendationBatch',
      resourceId: batch.batchId,
      metadata: { itemCount: batch.itemCount, snapshotId: batch.snapshotId },
    });

    return { batch };
  }

  async updateBatch(input: UpdateRecommendationBatchInput): Promise<{ batch: RecommendationBatch }> {
    const { principal, runId, batchId, request } = input;

    this.deps.appAuthorizationService.requireScope({ principal, scope: 'recommendations:batches:write' });

    const existing = await this.deps.batchRepo.getBatch({ appId: principal.appId, runId, batchId });
    if (!existing) {
      throw new Error('recommendation_batch_not_found');
    }

    const now = this.deps.clock.now();
    const batch = await this.deps.batchRepo.updateBatch({
      appId: principal.appId,
      runId,
      batchId,
      status: request.status,
      progress: request.progress,
      errors: request.errors,
      updatedAt: now,
    });

    await this.deps.appAuditRepo.insert({
      appId: principal.appId,
      keyId: principal.keyId,
      action: 'recommendation_batch_updated',
      runId,
      batchId: batch.batchId,
      resourceType: 'recommendationBatch',
      resourceId: batch.batchId,
      metadata: { status: batch.status, progress: batch.progress },
    });

    return { batch };
  }
}
