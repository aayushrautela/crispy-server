import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { AppPrincipal } from './app-principal.types.js';
import type { Clock } from './clock.js';
import type {
  CreateRecommendationRunInput,
  RecommendationRun,
  UpdateRecommendationRunInput,
} from './recommendation-run.types.js';
import type { RecommendationRunRepo } from './recommendation-run.repo.js';

export interface RecommendationRunService {
  createRun(input: CreateRecommendationRunInput): Promise<{ run: RecommendationRun }>;
  updateRun(input: UpdateRecommendationRunInput): Promise<{ run: RecommendationRun }>;
}

export class DefaultRecommendationRunService implements RecommendationRunService {
  constructor(
    private readonly deps: {
      repo: RecommendationRunRepo;
      appAuthorizationService: AppAuthorizationService;
      appAuditRepo: AppAuditRepo;
      clock: Clock;
    },
  ) {}

  async createRun(input: CreateRecommendationRunInput): Promise<{ run: RecommendationRun }> {
    const { principal, request } = input;

    this.deps.appAuthorizationService.requireScope({ principal, scope: 'recommendations:runs:write' });
    this.deps.appAuthorizationService.requireGrant({
      principal,
      resourceType: 'recommendationRun',
      resourceId: '*',
      purpose: 'recommendation-generation',
      action: 'create',
    });

    const now = this.deps.clock.now();
    const run = await this.deps.repo.createRun({
      appId: principal.appId,
      purpose: request.purpose,
      runType: request.runType,
      status: 'running',
      modelVersion: request.modelVersion ?? null,
      algorithm: request.algorithm ?? null,
      input: request.input ?? null,
      metadata: request.metadata ?? null,
      createdAt: now,
    });

    await this.deps.appAuditRepo.insert({
      appId: principal.appId,
      keyId: principal.keyId,
      action: 'recommendation_run_created',
      runId: run.runId,
      resourceType: 'recommendationRun',
      resourceId: run.runId,
      metadata: { runType: run.runType, purpose: run.purpose },
    });

    return { run };
  }

  async updateRun(input: UpdateRecommendationRunInput): Promise<{ run: RecommendationRun }> {
    const { principal, runId, request } = input;

    this.deps.appAuthorizationService.requireScope({ principal, scope: 'recommendations:runs:write' });

    const existing = await this.deps.repo.getRun({ appId: principal.appId, runId });
    if (!existing) {
      throw new Error('recommendation_run_not_found');
    }

    const now = this.deps.clock.now();
    const completedAt =
      request.status === 'completed' || request.status === 'failed' || request.status === 'cancelled'
        ? now
        : undefined;

    const run = await this.deps.repo.updateRun({
      appId: principal.appId,
      runId,
      status: request.status,
      progress: request.progress,
      output: request.output ?? null,
      error: request.error ?? null,
      updatedAt: now,
      completedAt,
    });

    await this.deps.appAuditRepo.insert({
      appId: principal.appId,
      keyId: principal.keyId,
      action: 'recommendation_run_updated',
      runId: run.runId,
      resourceType: 'recommendationRun',
      resourceId: run.runId,
      metadata: { status: run.status, progress: run.progress },
    });

    return { run };
  }
}
