import { randomUUID } from 'node:crypto';
import { withTransaction, type DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../lib/errors.js';
import { recommendationConfig } from './recommendation-config.js';
import { RecommendationGenerationService } from './recommendation-generation.service.js';
import {
  RecommendationEngineClient,
} from './recommendation-engine-client.js';
import {
  RecommendationGenerationJobsRepository,
  type RecommendationGenerationJobRecord,
} from './recommendation-generation-jobs.repo.js';
import type {
  RecommendationWorkerGenerateRequest,
  RecommendationWorkerStatusResponse,
  RecommendationWorkerSubmitResponse,
} from './recommendation-worker.types.js';

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;
type PollEnqueueFn = (jobId: string, delayMs?: number) => Promise<void>;

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
  constructor(
    private readonly generationService = new RecommendationGenerationService(),
    private readonly jobsRepository = new RecommendationGenerationJobsRepository(),
    private readonly workerClient = new RecommendationEngineClient(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
    private readonly enqueuePoll: PollEnqueueFn = defaultEnqueueRecommendationPoll,
    private readonly config: Pick<typeof recommendationConfig, 'workerMode' | 'pollDelayMs' | 'maxPollDelayMs'> = recommendationConfig,
  ) {}

  async ensureGeneration(profileId: string): Promise<{ jobId: string; status: string; mode: 'sync' | 'async' }> {
    if (this.config.workerMode === 'sync') {
      const result = await this.generationService.generateForProfile(profileId);
      return {
        jobId: `sync:${result.profileId}:${result.historyGeneration}`,
        status: 'succeeded',
        mode: 'sync',
      };
    }

    const { context, payload } = await this.generationService.buildGenerationRequest(profileId);
    const idempotencyKey = buildIdempotencyKey(payload);

    const job = await this.findOrCreateJob({
      profileId: context.profileId,
      accountId: context.accountId,
      sourceKey: payload.generationMeta.sourceKey,
      algorithmVersion: payload.generationMeta.algorithmVersion,
      historyGeneration: payload.generationMeta.historyGeneration,
      idempotencyKey,
      requestPayload: payload as unknown as Record<string, unknown>,
    });

    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return { jobId: job.id, status: job.status, mode: 'async' };
    }

    if (job.workerJobId && (job.status === 'queued' || job.status === 'running')) {
      await this.schedulePoll(job, resolveNextPollDelayMs(this.config, job.lastStatusPayload));
      return { jobId: job.id, status: job.status, mode: 'async' };
    }

    const submission = await this.submitJob(job);
    return { jobId: job.id, status: submission.status, mode: 'async' };
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
            nextPollAt: null,
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

      const nextPollAt = buildNextPollAt(this.config, response.pollAfterSeconds);
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markSubmitted(client, job.id, {
          workerJobId: response.jobId,
          status: response.status,
          acceptedAt: response.acceptedAt ?? null,
          nextPollAt,
          lastStatusPayload: response as unknown as Record<string, unknown>,
        });
      });
      await this.enqueuePoll(job.id, resolvePollDelayMs(this.config, response.pollAfterSeconds));
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
          nextPollAt: buildNextPollAt(this.config, undefined, retryDelayMs),
        });
      });
      await this.schedulePoll(job, retryDelayMs);
      throw error;
    }
  }

  async pollJob(jobId: string): Promise<{ status: string }> {
    const job = await this.runInTransaction(async (client) => this.jobsRepository.findById(client, jobId));
    if (!job) {
      throw new HttpError(404, 'Recommendation generation job not found.');
    }
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return { status: job.status };
    }
    if (!job.workerJobId) {
      if (job.status === 'pending') {
        const submission = await this.submitJob(job);
        return { status: submission.status };
      }
      throw new HttpError(409, 'Recommendation generation job has not been submitted yet.');
    }

    const requestId = `recommendation-status:${job.id}:${randomUUID()}`;
    try {
      const status = await this.workerClient.getGenerationStatus(job.workerJobId, requestId);
      const result = await this.handleStatus(job, status);
      return { status: result };
    } catch (error) {
      const retryDelayMs = Math.min(this.config.maxPollDelayMs, this.config.pollDelayMs * 2);
      const nextPollAt = buildNextPollAt(this.config, undefined, retryDelayMs);
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markPollError(client, job.id, {
          nextPollAt,
          failureJson: toFailureJson(error),
        });
      });
      await this.enqueuePoll(job.id, retryDelayMs);
      throw error;
    }
  }

  async reconcileDueJobs(limit = 25): Promise<{ recoveredCount: number; inspectedCount: number }> {
    if (this.config.workerMode !== 'async') {
      return { recoveredCount: 0, inspectedCount: 0 };
    }

    const now = new Date();
    const stalePendingBefore = new Date(now.getTime() - this.config.maxPollDelayMs).toISOString();
    const jobs = await this.runInTransaction(async (client) => this.jobsRepository.listRecoverable(client, {
      now: now.toISOString(),
      stalePendingBefore,
      limit,
    }));

    let recoveredCount = 0;
    for (const job of jobs) {
      if (job.status === 'pending') {
        try {
          await this.submitJob(job);
          recoveredCount += 1;
        } catch (error) {
          logger.warn({ localJobId: job.id, err: error }, 'failed to recover pending recommendation generation job');
        }
        continue;
      }

      if (job.status === 'queued' || job.status === 'running') {
        await this.schedulePoll(job, 0);
        recoveredCount += 1;
      }
    }

    if (jobs.length > 0) {
      logger.info({ recoveredCount, inspectedCount: jobs.length }, 'reconciled recommendation generation jobs');
    }

    return { recoveredCount, inspectedCount: jobs.length };
  }

  private async handleStatus(job: RecommendationGenerationJobRecord, status: RecommendationWorkerStatusResponse): Promise<string> {
    if (status.status === 'queued' || status.status === 'running') {
      const nextPollAt = buildNextPollAt(this.config, status.pollAfterSeconds);
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markStatusPolled(client, job.id, {
          status: status.status,
          startedAt: status.startedAt ?? null,
          nextPollAt,
          lastStatusPayload: status as unknown as Record<string, unknown>,
        });
      });
      await this.enqueuePoll(job.id, resolvePollDelayMs(this.config, status.pollAfterSeconds));
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

  private async schedulePoll(job: RecommendationGenerationJobRecord, delayMs: number): Promise<void> {
    if (this.config.workerMode !== 'async') {
      return;
    }
    await this.enqueuePoll(job.id, delayMs);
  }

  private async findOrCreateJob(params: {
    profileId: string;
    accountId: string;
    sourceKey: string;
    algorithmVersion: string;
    historyGeneration: number;
    idempotencyKey: string;
    requestPayload: Record<string, unknown>;
  }): Promise<RecommendationGenerationJobRecord> {
    return this.runInTransaction(async (client) => {
      const existing = await this.jobsRepository.findByGenerationKey(client, {
        profileId: params.profileId,
        sourceKey: params.sourceKey,
        algorithmVersion: params.algorithmVersion,
        historyGeneration: params.historyGeneration,
      });
      if (existing) {
        return existing;
      }

      try {
        return await this.jobsRepository.create(client, params);
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
        if (raced) {
          return raced;
        }
        throw error;
      }
    });
  }
}

async function defaultEnqueueRecommendationPoll(jobId: string, delayMs?: number): Promise<void> {
  const { enqueueRecommendationGenerationPoll } = await import('../../lib/queue.js');
  await enqueueRecommendationGenerationPoll(jobId, delayMs);
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

function resolveNextPollDelayMs(
  config: Pick<typeof recommendationConfig, 'pollDelayMs' | 'maxPollDelayMs'>,
  payload: Record<string, unknown>,
): number {
  const raw = payload.pollAfterSeconds;
  return resolvePollDelayMs(config, typeof raw === 'number' ? raw : null);
}

function buildNextPollAt(
  config: Pick<typeof recommendationConfig, 'pollDelayMs' | 'maxPollDelayMs'>,
  pollAfterSeconds?: number | null,
  fallbackDelayMs?: number,
): string {
  const delayMs = typeof fallbackDelayMs === 'number' ? fallbackDelayMs : resolvePollDelayMs(config, pollAfterSeconds);
  return new Date(Date.now() + delayMs).toISOString();
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
