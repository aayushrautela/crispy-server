import { randomUUID } from 'node:crypto';
import { withTransaction, type DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../lib/errors.js';
import { enqueueRecommendationSubmit, enqueueRecommendationSync, type RecommendationQueueStrategy } from '../../lib/queue.js';
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
  RecommendationWorkerGenerateResponse,
  RecommendationWorkerGenerationStatus,
  RecommendationWorkerStatusResponse,
  RecommendationWorkerSubmitResponse,
} from './recommendation-worker.types.js';

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

type RecommendationQueueScheduler = {
  enqueueSubmit(jobId: string, delayMs?: number, strategy?: RecommendationQueueStrategy): Promise<void>;
  enqueueSync(jobId: string, delayMs?: number, strategy?: RecommendationQueueStrategy): Promise<void>;
};

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

type RecommendationWorkerActiveStatus = Extract<RecommendationWorkerGenerationStatus, 'queued' | 'running'>;

export class RecommendationGenerationOrchestratorService {
  constructor(
    private readonly generationService = new RecommendationGenerationService(),
    private readonly jobsRepository = new RecommendationGenerationJobsRepository(),
    private readonly workerClient = new RecommendationEngineClient(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
    private readonly config: Pick<typeof recommendationConfig, 'queueDelayMs' | 'pollDelayMs' | 'maxPollDelayMs'> = recommendationConfig,
    private readonly queueScheduler: RecommendationQueueScheduler = {
      enqueueSubmit: enqueueRecommendationSubmit,
      enqueueSync: enqueueRecommendationSync,
    },
  ) {}

  async ensureGeneration(profileId: string, options?: {
    delayMs?: number;
    triggerSource?: RecommendationGenerationTriggerSource;
  }): Promise<{ jobId: string; status: string; created: boolean }> {
    const context = await this.resolveRequestContext(profileId);
    const payload = buildRegistrationPayload(context);
    const idempotencyKey = buildIdempotencyKey(payload);
    const triggerSource = options?.triggerSource ?? 'system';

    const result = await this.runInTransaction(async (client) => {
      const result = await this.findOrCreateJob(client, {
        profileId: context.profileId,
        accountId: context.accountId,
        sourceKey: payload.generationMeta.sourceKey,
        algorithmVersion: payload.generationMeta.algorithmVersion,
        historyGeneration: payload.generationMeta.historyGeneration,
        idempotencyKey,
        triggerSource,
        requestPayload: {},
      });

      await this.jobsRepository.cancelSuperseded(client, {
        profileId: context.profileId,
        sourceKey: payload.generationMeta.sourceKey,
        algorithmVersion: payload.generationMeta.algorithmVersion,
        historyGeneration: payload.generationMeta.historyGeneration,
      });

      return result;
    });

    await this.queueScheduler.enqueueSubmit(result.jobId, Math.max(0, options?.delayMs ?? this.config.queueDelayMs));
    return result;
  }

  private async resolveRequestContext(profileId: string): Promise<Awaited<ReturnType<RecommendationGenerationService['loadRequestContext']>>> {
    const service = this.generationService as RecommendationGenerationService & {
      loadRequestContext?: (profileId: string) => Promise<Awaited<ReturnType<RecommendationGenerationService['loadRequestContext']>>>;
    };

    if (typeof service.loadRequestContext === 'function') {
      return service.loadRequestContext(profileId);
    }

    const fallback = await this.generationService.buildGenerationRequest(profileId);
    return fallback.context;
  }

  async submitQueuedJob(jobId: string): Promise<void> {
    const job = await this.runInTransaction(async (client) => this.jobsRepository.findById(client, jobId));
    if (!job || job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return;
    }

    if (job.workerJobId) {
      await this.queueScheduler.enqueueSync(job.id);
      return;
    }

    const { payload } = await this.generationService.buildGenerationRequest(job.profileId);
    if (
      payload.generationMeta.sourceKey !== job.sourceKey
      || payload.generationMeta.algorithmVersion !== job.algorithmVersion
      || payload.generationMeta.historyGeneration !== job.historyGeneration
    ) {
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markTerminal(client, job.id, {
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
          failureJson: {
            code: 'stale_generation_context',
            message: 'Recommendation generation context changed before queued submission ran.',
          },
        });
      });
      return;
    }

    await this.submitJob({
      ...job,
      requestPayload: payload as unknown as Record<string, unknown>,
    });
  }

  async syncQueuedJob(jobId: string): Promise<void> {
    const job = await this.runInTransaction(async (client) => this.jobsRepository.findById(client, jobId));
    if (!job) {
      return;
    }
    if (job.status === 'succeeded') {
      await this.applySucceededJobResult(job);
      return;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      return;
    }
    if (!job.workerJobId) {
      if (job.status === 'pending') {
        await this.queueScheduler.enqueueSubmit(job.id);
      }
      return;
    }
    await this.syncTrackedJob(job);
  }

  async enqueueRecoveryJobs(limit = 250): Promise<{ enqueuedCount: number }> {
    const jobs = await this.runInTransaction(async (client) => this.jobsRepository.listRecoveryCandidates(client, limit));

    for (const job of jobs) {
      if (job.status === 'pending' && !job.workerJobId) {
        await this.queueScheduler.enqueueSubmit(job.id);
        continue;
      }
      await this.queueScheduler.enqueueSync(job.id);
    }

    return { enqueuedCount: jobs.length };
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
        const submittedStatus = isActiveStatus(terminalStatus.status)
          ? { status: terminalStatus.status }
          : {
              status: terminalStatus.status,
            };
        await this.runInTransaction(async (client) => {
          await this.jobsRepository.markSubmitted(client, job.id, {
            workerJobId: response.jobId,
            status: submittedStatus.status,
            acceptedAt: response.acceptedAt ?? null,
            lastStatusPayload: response as unknown as Record<string, unknown>,
          });
        });
        if (isActiveStatus(terminalStatus.status)) {
          await this.queueScheduler.enqueueSync(
            job.id,
            resolvePollDelayMs(this.config, terminalStatus.pollAfterSeconds),
            'followup',
          );
        }
        const finalStatus = await this.handleStatus({
          ...job,
          workerJobId: response.jobId,
          status: submittedStatus.status,
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

      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markSubmitted(client, job.id, {
          workerJobId: response.jobId,
          status: response.status,
          acceptedAt: response.acceptedAt ?? null,
          lastStatusPayload: response as unknown as Record<string, unknown>,
        });
      });
      await this.queueScheduler.enqueueSync(
        job.id,
        resolvePollDelayMs(this.config, response.pollAfterSeconds),
        'followup',
      );
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
        });
      });
      await this.queueScheduler.enqueueSubmit(job.id, retryDelayMs, 'followup');
      throw error;
    }
  }

  private async handleStatus(job: RecommendationGenerationJobRecord, status: RecommendationWorkerStatusResponse): Promise<string> {
    if (status.status === 'queued' || status.status === 'running') {
      const activeStatus: RecommendationWorkerActiveStatus = status.status;
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markStatusPolled(client, job.id, {
          status: activeStatus,
          startedAt: status.startedAt ?? null,
          lastStatusPayload: status as unknown as Record<string, unknown>,
        });
      });
      await this.queueScheduler.enqueueSync(
        job.id,
        resolvePollDelayMs(this.config, status.pollAfterSeconds),
        'followup',
      );
      return activeStatus;
    }

    if (status.status === 'succeeded') {
      if (!status.result) {
        throw new HttpError(502, 'Recommendation worker reported success without a result.');
      }

      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markTerminal(client, job.id, {
          status: 'succeeded',
          startedAt: status.startedAt ?? null,
          completedAt: status.completedAt ?? new Date().toISOString(),
          lastStatusPayload: status as unknown as Record<string, unknown>,
          failureJson: {},
        });
      });
      await this.applySucceededJobResult({
        ...job,
        status: 'succeeded',
        lastStatusPayload: status as unknown as Record<string, unknown>,
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

  private async syncTrackedJob(job: RecommendationGenerationJobRecord): Promise<string> {
    const requestId = `recommendation-status:${job.id}:${randomUUID()}`;
    try {
      const status = await this.workerClient.getGenerationStatus(job.workerJobId ?? '', requestId);
      return this.handleStatus(job, status);
    } catch (error) {
      const retryDelayMs = Math.min(this.config.maxPollDelayMs, this.config.pollDelayMs * 2);
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markPollError(client, job.id, {
          failureJson: toFailureJson(error),
        });
      });
      await this.queueScheduler.enqueueSync(job.id, retryDelayMs, 'followup');
      throw error;
    }
  }

  private async applySucceededJobResult(job: RecommendationGenerationJobRecord): Promise<void> {
    if (job.resultAppliedAt) {
      return;
    }

    const statusPayload = asRecord(job.lastStatusPayload);
    const result = statusPayload.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markApplyError(client, job.id, {
          applyErrorJson: {
            code: 'missing_terminal_result',
            message: 'Succeeded recommendation job is missing a stored worker result.',
          },
        });
      });
      throw new HttpError(502, 'Succeeded recommendation job is missing a stored worker result.');
    }

    const payload = parseStoredPayload(job.requestPayload);

    try {
      await this.generationService.applyWorkerResponse({
        accountId: payload.identity.accountId,
        profileId: payload.identity.profileId,
        historyGeneration: payload.generationMeta.historyGeneration,
        sourceCursor: payload.generationMeta.sourceCursor ?? null,
      }, result as RecommendationWorkerGenerateResponse);
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markResultApplied(client, job.id);
      });
    } catch (error) {
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markApplyError(client, job.id, {
          applyErrorJson: toFailureJson(error),
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

function buildRegistrationPayload(context: Awaited<ReturnType<RecommendationGenerationService['loadRequestContext']>>): RecommendationWorkerGenerateRequest {
  return {
    identity: {
      accountId: context.accountId,
      profileId: context.profileId,
    },
    generationMeta: {
      sourceKey: recommendationConfig.sourceKey,
      algorithmVersion: recommendationConfig.algorithmVersion as RecommendationWorkerGenerateRequest['generationMeta']['algorithmVersion'],
      historyGeneration: context.historyGeneration,
      sourceCursor: context.sourceCursor,
      ttlSeconds: recommendationConfig.generationTtlSeconds,
    },
    watchHistory: [],
    ratings: [],
    watchlist: [],
    profileContext: {
      profileName: context.profileName,
      isKids: context.isKids,
      watchDataOrigin: context.currentOrigin,
    },
    aiConfig: {
      providerId: 'queued',
      endpointUrl: '',
      httpReferer: '',
      title: '',
      model: '',
      apiKey: '',
      credentialSource: 'server',
    },
    optionalExtras: {
      continueWatching: [],
      trackedSeries: [],
      limits: recommendationConfig.payloadLimits,
    },
  };
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

function isTerminalStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function isActiveStatus(status: RecommendationWorkerGenerationStatus): status is RecommendationWorkerActiveStatus {
  return status === 'queued' || status === 'running';
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
