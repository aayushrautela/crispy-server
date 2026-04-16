import { randomUUID } from 'node:crypto';
import { withTransaction, type DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../lib/errors.js';
import { recommendationConfig } from './recommendation-config.js';
import { RecommendationGenerationService } from './recommendation-generation.service.js';
import { RecommendationEngineClient } from './recommendation-engine-client.js';
import {
  RecommendationGenerationJobsRepository,
  type RecommendationGenerationJobRecord,
  type RecommendationGenerationTriggerSource,
} from './recommendation-generation-jobs.repo.js';
import type {
  RecommendationWorkerGenerateRequest,
  RecommendationWorkerStatusResponse,
  RecommendationWorkerSubmitResponse,
} from './recommendation-worker.types.js';

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

type ParsedGenerationPayload = {
  identity: {
    accountId: string;
    profileId: string;
  };
  generationMeta: {
    sourceKey: string;
    algorithmVersion: string;
    historyGeneration: number;
    sourceCursor?: string | null;
  };
};

export class RecommendationGenerationOrchestratorService {
  private readonly leaseOwner = `recommendation-runner:${process.pid}`;

  constructor(
    private readonly generationService = new RecommendationGenerationService(),
    private readonly jobsRepository = new RecommendationGenerationJobsRepository(),
    private readonly workerClient = new RecommendationEngineClient(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
    private readonly config: Pick<typeof recommendationConfig, 'queueDelayMs' | 'pollDelayMs' | 'maxPollDelayMs'> = recommendationConfig,
  ) {}

  async ensureGeneration(profileId: string, options?: {
    delayMs?: number;
    triggerSource?: RecommendationGenerationTriggerSource;
  }): Promise<{ jobId: string; status: string; created: boolean }> {
    const { context, payload } = await this.generationService.buildGenerationRequest(profileId);
    const idempotencyKey = buildIdempotencyKey(payload);
    const nextRunAt = buildNextRunAt(options?.delayMs ?? this.config.queueDelayMs);
    const triggerSource = options?.triggerSource ?? 'system';

    return this.runInTransaction(async (client) => {
      const result = await this.findOrCreateJob(client, {
        profileId: context.profileId,
        accountId: context.accountId,
        sourceKey: payload.generationMeta.sourceKey,
        algorithmVersion: payload.generationMeta.algorithmVersion,
        historyGeneration: payload.generationMeta.historyGeneration,
        idempotencyKey,
        triggerSource,
        requestPayload: payload as unknown as Record<string, unknown>,
        nextRunAt,
      });

      await this.jobsRepository.cancelSuperseded(client, {
        profileId: context.profileId,
        sourceKey: payload.generationMeta.sourceKey,
        algorithmVersion: payload.generationMeta.algorithmVersion,
        historyGeneration: payload.generationMeta.historyGeneration,
      });

      return result;
    });
  }

  async submitJob(job: RecommendationGenerationJobRecord): Promise<RecommendationWorkerSubmitResponse> {
    const payload = parseStoredPayload(job.requestPayload);
    const requestId = `recommendation-submit:${job.id}:${randomUUID()}`;

    try {
      const response = await this.workerClient.submitGeneration(job.requestPayload as unknown as RecommendationWorkerGenerateRequest, {
        idempotencyKey: job.idempotencyKey,
        requestId,
      });

      if (isTerminalStatus(response.status)) {
        const terminalStatus = await this.workerClient.getGenerationStatus(
          response.jobId,
          `recommendation-status:${job.id}:${randomUUID()}`,
        );
        await this.runInTransaction(async (client) => {
          await this.jobsRepository.markSubmitted(client, job.id, {
            workerJobId: response.jobId,
            status: 'queued',
            acceptedAt: response.acceptedAt ?? null,
            nextRunAt: null,
            lastStatusPayload: response as unknown as Record<string, unknown>,
          });
        });
        const finalStatus = await this.handleStatus({
          ...job,
          workerJobId: response.jobId,
          status: 'queued',
        }, terminalStatus);
        logger.info({
          localJobId: job.id,
          workerJobId: response.jobId,
          profileId: payload.identity.profileId,
          historyGeneration: payload.generationMeta.historyGeneration,
          finalStatus,
        }, 'submitted recommendation generation job');
        return {
          ...response,
          status: finalStatus as RecommendationWorkerSubmitResponse['status'],
        };
      }

      const nextRunAt = buildNextRunAt(resolvePollDelayMs(this.config, response.pollAfterSeconds));
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markSubmitted(client, job.id, {
          workerJobId: response.jobId,
          status: response.status,
          acceptedAt: response.acceptedAt ?? null,
          nextRunAt,
          lastStatusPayload: response as unknown as Record<string, unknown>,
        });
      });
      logger.info({
        localJobId: job.id,
        workerJobId: response.jobId,
        profileId: payload.identity.profileId,
        historyGeneration: payload.generationMeta.historyGeneration,
      }, 'submitted recommendation generation job');
      return response;
    } catch (error) {
      const retryDelayMs = resolveRetryDelayMs(this.config, job.submitAttempts + 1);
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markSubmitError(client, job.id, {
          failureJson: toFailureJson(error),
          nextRunAt: buildNextRunAt(retryDelayMs),
        });
      });
      throw error;
    }
  }

  async pollJob(jobId: string): Promise<{ status: string }> {
    const now = new Date().toISOString();
    const claimed = await this.runInTransaction(async (client) => this.jobsRepository.claimById(client, {
      jobId,
      now,
      leaseOwner: this.leaseOwner,
      leaseSeconds: recommendationLeaseSeconds(),
    }));

    if (!claimed) {
      const existing = await this.runInTransaction(async (client) => this.jobsRepository.findById(client, jobId));
      if (!existing) {
        throw new HttpError(404, 'Recommendation generation job not found.');
      }
      if (existing.status === 'succeeded' || existing.status === 'failed' || existing.status === 'cancelled') {
        return { status: existing.status };
      }
      throw new HttpError(409, 'Recommendation generation job is already being processed.');
    }

    return this.processClaimedJob(claimed);
  }

  async reconcileDueJobs(limit = 25): Promise<{ recoveredCount: number; inspectedCount: number }> {
    const now = new Date().toISOString();
    const jobs = await this.runInTransaction(async (client) => this.jobsRepository.claimDueJobs(client, {
      now,
      leaseOwner: this.leaseOwner,
      leaseSeconds: recommendationLeaseSeconds(),
      limit,
    }));

    let recoveredCount = 0;
    for (const job of jobs) {
      try {
        await this.processClaimedJob(job);
        recoveredCount += 1;
      } catch (error) {
        logger.warn({ localJobId: job.id, err: error }, 'failed to process recommendation generation job');
      }
    }

    if (jobs.length > 0) {
      logger.info({ recoveredCount, inspectedCount: jobs.length }, 'reconciled recommendation generation jobs');
    }

    return { recoveredCount, inspectedCount: jobs.length };
  }

  private async handleStatus(job: RecommendationGenerationJobRecord, status: RecommendationWorkerStatusResponse): Promise<string> {
    if (status.status === 'queued' || status.status === 'running') {
      const nextRunAt = buildNextRunAt(resolvePollDelayMs(this.config, status.pollAfterSeconds));
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markStatusPolled(client, job.id, {
          status: status.status,
          startedAt: status.startedAt ?? null,
          nextRunAt,
          lastStatusPayload: status as unknown as Record<string, unknown>,
        });
      });
      return status.status;
    }

    if (status.status === 'succeeded') {
      if (!status.result) {
        throw new HttpError(502, 'Recommendation worker reported success without a result.');
      }

      const payload = parseStoredPayload(job.requestPayload);
      await this.generationService.applyWorkerResponse({
        accountId: payload.identity.accountId,
        profileId: payload.identity.profileId,
        historyGeneration: payload.generationMeta.historyGeneration,
        sourceCursor: payload.generationMeta.sourceCursor ?? null,
      }, status.result);
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markTerminal(client, job.id, {
          status: 'succeeded',
          startedAt: status.startedAt ?? null,
          completedAt: status.completedAt ?? new Date().toISOString(),
          lastStatusPayload: status as unknown as Record<string, unknown>,
          failureJson: {},
        });
      });
      return 'succeeded';
    }

    if (status.status === 'cancelled') {
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markTerminal(client, job.id, {
          status: 'cancelled',
          startedAt: status.startedAt ?? null,
          cancelledAt: status.cancelledAt ?? new Date().toISOString(),
          lastStatusPayload: status as unknown as Record<string, unknown>,
          failureJson: status.failure ? status.failure as unknown as Record<string, unknown> : {},
        });
      });
      return 'cancelled';
    }

    await this.runInTransaction(async (client) => {
      await this.jobsRepository.markTerminal(client, job.id, {
        status: 'failed',
        startedAt: status.startedAt ?? null,
        completedAt: status.completedAt ?? new Date().toISOString(),
        lastStatusPayload: status as unknown as Record<string, unknown>,
        failureJson: status.failure ? status.failure as unknown as Record<string, unknown> : {},
      });
    });
    return 'failed';
  }

  private async processClaimedJob(job: RecommendationGenerationJobRecord): Promise<{ status: string }> {
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return { status: job.status };
    }
    if (!job.workerJobId || job.status === 'pending') {
      const submission = await this.submitJob(job);
      return { status: submission.status };
    }
    return this.pollClaimedJob(job);
  }

  private async pollClaimedJob(job: RecommendationGenerationJobRecord): Promise<{ status: string }> {
    const requestId = `recommendation-status:${job.id}:${randomUUID()}`;
    try {
      const status = await this.workerClient.getGenerationStatus(job.workerJobId ?? '', requestId);
      const result = await this.handleStatus(job, status);
      return { status: result };
    } catch (error) {
      const retryDelayMs = Math.min(this.config.maxPollDelayMs, this.config.pollDelayMs * 2);
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markPollError(client, job.id, {
          nextRunAt: buildNextRunAt(retryDelayMs),
          failureJson: toFailureJson(error),
        });
      });
      throw error;
    }
  }

  private async findOrCreateJob(client: DbClient, params: {
    profileId: string;
    accountId: string;
    sourceKey: string;
    algorithmVersion: string;
    historyGeneration: number;
    idempotencyKey: string;
    triggerSource: RecommendationGenerationTriggerSource;
    requestPayload: Record<string, unknown>;
    nextRunAt: string;
  }): Promise<{ jobId: string; status: string; created: boolean }> {
    const existing = await this.jobsRepository.findByGenerationKey(client, {
      profileId: params.profileId,
      sourceKey: params.sourceKey,
      algorithmVersion: params.algorithmVersion,
      historyGeneration: params.historyGeneration,
    });
    if (existing) {
      if (existing.status === 'succeeded' || existing.status === 'failed' || existing.status === 'cancelled') {
        return { jobId: existing.id, status: existing.status, created: false };
      }
      await this.jobsRepository.markRequested(client, existing.id, {
        triggerSource: params.triggerSource,
        requestPayload: params.requestPayload,
        nextRunAt: params.nextRunAt,
      });
      const refreshed = await this.jobsRepository.findById(client, existing.id);
      const job = refreshed ?? existing;
      return { jobId: job.id, status: job.status, created: false };
    }

    try {
      const created = await this.jobsRepository.create(client, {
        profileId: params.profileId,
        accountId: params.accountId,
        sourceKey: params.sourceKey,
        algorithmVersion: params.algorithmVersion,
        historyGeneration: params.historyGeneration,
        idempotencyKey: params.idempotencyKey,
        triggerSource: params.triggerSource,
        requestPayload: params.requestPayload,
        nextRunAt: params.nextRunAt,
      });
      return { jobId: created.id, status: created.status, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.jobsRepository.findByGenerationKey(client, {
        profileId: params.profileId,
        sourceKey: params.sourceKey,
        algorithmVersion: params.algorithmVersion,
        historyGeneration: params.historyGeneration,
      });
      if (!raced) {
        throw error;
      }
      if (raced.status !== 'succeeded' && raced.status !== 'failed' && raced.status !== 'cancelled') {
        await this.jobsRepository.markRequested(client, raced.id, {
          triggerSource: params.triggerSource,
          requestPayload: params.requestPayload,
          nextRunAt: params.nextRunAt,
        });
      }
      return { jobId: raced.id, status: raced.status, created: false };
    }
  }
}

function buildIdempotencyKey(payload: RecommendationWorkerGenerateRequest): string {
  return [
    'recommendation',
    payload.identity.profileId,
    payload.generationMeta.sourceKey,
    payload.generationMeta.algorithmVersion,
    String(payload.generationMeta.historyGeneration),
  ].join(':');
}

function resolvePollDelayMs(
  config: Pick<typeof recommendationConfig, 'pollDelayMs' | 'maxPollDelayMs'>,
  pollAfterSeconds?: number | null,
): number {
  if (typeof pollAfterSeconds === 'number' && Number.isFinite(pollAfterSeconds) && pollAfterSeconds > 0) {
    return Math.min(config.maxPollDelayMs, Math.max(1000, Math.trunc(pollAfterSeconds * 1000)));
  }
  return config.pollDelayMs;
}

function resolveRetryDelayMs(
  config: Pick<typeof recommendationConfig, 'pollDelayMs' | 'maxPollDelayMs'>,
  attemptCount: number,
): number {
  const multiplier = Math.max(1, 2 ** Math.max(0, attemptCount - 1));
  return Math.min(config.maxPollDelayMs, config.pollDelayMs * multiplier);
}

function buildNextRunAt(delayMs: number): string {
  return new Date(Date.now() + delayMs).toISOString();
}

function recommendationLeaseSeconds(): number {
  return 60;
}

function isTerminalStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function toFailureJson(error: unknown): Record<string, unknown> {
  if (error instanceof HttpError) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      details: asRecord(error.details),
    };
  }

  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function parseStoredPayload(value: Record<string, unknown>): ParsedGenerationPayload {
  const identity = asRecord(value.identity);
  const generationMeta = asRecord(value.generationMeta);
  return {
    identity: {
      accountId: String(identity.accountId),
      profileId: String(identity.profileId),
    },
    generationMeta: {
      sourceKey: String(generationMeta.sourceKey),
      algorithmVersion: String(generationMeta.algorithmVersion),
      historyGeneration: Number(generationMeta.historyGeneration),
      sourceCursor: typeof generationMeta.sourceCursor === 'string' ? generationMeta.sourceCursor : null,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isUniqueViolation(error: unknown): boolean {
  const code = asRecord(error).code;
  return typeof code === 'string' && code === '23505';
}
