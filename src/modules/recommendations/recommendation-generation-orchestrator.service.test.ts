import test from 'node:test';
import assert from 'node:assert/strict';
import { NOOP_TRANSACTION, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { RecommendationGenerationOrchestratorService } = await import('./recommendation-generation-orchestrator.service.js');

function createStoredRequest() {
  return {
    identity: {
      accountId: 'account-1',
      profileId: 'profile-1',
    },
    generationMeta: {
      sourceKey: 'default',
      algorithmVersion: 'v3.2.1',
      historyGeneration: 12,
      sourceCursor: 'cursor-1',
    },
    watchHistory: [],
    ratings: [],
    watchlist: [],
    profileContext: {
      profileName: 'Main',
      isKids: false,
      watchDataOrigin: 'provider_sync',
    },
    aiConfig: {
      providerId: 'openai',
      endpointUrl: 'https://example.com/v1/chat/completions',
      httpReferer: 'https://crispy.example',
      title: 'Crispy',
      model: 'gpt-4o-mini',
      apiKey: 'secret',
      credentialSource: 'server' as const,
    },
    optionalExtras: {
      continueWatching: [],
      trackedSeries: [],
      limits: {
        watchHistory: 100,
        ratings: 100,
        watchlist: 100,
        continueWatching: 50,
        trackedSeries: 25,
      },
    },
  };
}

function createJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'local-job-1',
    profileId: 'profile-1',
    accountId: 'account-1',
    sourceKey: 'default',
    algorithmVersion: 'v3.2.1',
    historyGeneration: 12,
    idempotencyKey: 'recommendation:profile-1:default:v3.2.1:12',
    workerJobId: null,
    status: 'pending',
    requestPayload: createStoredRequest(),
    lastStatusPayload: {},
    failureJson: {},
    submitAttempts: 0,
    pollAttempts: 0,
    pollErrorCount: 0,
    acceptedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    lastSubmittedAt: null,
    lastPolledAt: null,
    nextPollAt: null,
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
    ...overrides,
  } as const;
}

function createWorkerResult() {
  return {
    tasteProfile: {
      sourceKey: 'default',
      genres: ['Drama'],
    },
    recommendationSnapshot: {
      sourceKey: 'default',
      algorithmVersion: 'v3.2.1',
      historyGeneration: 12,
      sourceCursor: 'cursor-1',
      generatedAt: '2026-04-04T00:01:00.000Z',
      sections: [],
    },
    generation: {
      completedAt: '2026-04-04T00:01:00.000Z',
    },
  };
}

test('ensureGeneration creates and submits async job', async () => {
  const createdJobs: Array<Record<string, unknown>> = [];
  const submittedJobs: Array<Record<string, unknown>> = [];
  const scheduledPolls: Array<{ jobId: string; delayMs?: number }> = [];
  const buildResult = {
    context: {
      accountId: 'account-1',
      profileId: 'profile-1',
      profileName: 'Main',
      isKids: false,
      historyGeneration: 12,
      currentOrigin: 'provider_sync',
      sourceCursor: 'cursor-1',
    },
    payload: createStoredRequest(),
  };
  const job = createJob();

  const service = new RecommendationGenerationOrchestratorService(
    {
      buildGenerationRequest: async () => buildResult,
      generateForProfile: async () => { throw new Error('not used'); },
      applyWorkerResponse: async () => ({ profileId: 'profile-1', sourceKey: 'default', algorithmVersion: 'v3.2.1', historyGeneration: 12, sections: 0 }),
    } as never,
    {
      findByGenerationKey: async () => null,
      create: async (_client: unknown, params: Record<string, unknown>) => {
        createdJobs.push(params);
        return job;
      },
      markSubmitted: async (_client: unknown, _jobId: string, params: Record<string, unknown>) => {
        submittedJobs.push(params);
      },
    } as never,
    {
      submitGeneration: async () => ({
        jobId: 'worker-job-1',
        status: 'queued',
        idempotencyKey: job.idempotencyKey,
        acceptedAt: '2026-04-04T00:00:01.000Z',
        pollAfterSeconds: 3,
      }),
      getGenerationStatus: async () => { throw new Error('not used'); },
    } as never,
    NOOP_TRANSACTION,
    async (jobId, delayMs) => { scheduledPolls.push({ jobId, delayMs }); },
    { workerMode: 'async', pollDelayMs: 1500, maxPollDelayMs: 10_000 },
  );

  const result = await service.ensureGeneration('profile-1');

  assert.equal(result.mode, 'async');
  assert.equal(result.jobId, 'local-job-1');
  assert.equal(result.status, 'queued');
  assert.equal(createdJobs.length, 1);
  assert.equal(submittedJobs.length, 1);
  assert.equal(submittedJobs[0]?.workerJobId, 'worker-job-1');
  assert.equal(scheduledPolls.length, 1);
  assert.equal(scheduledPolls[0]?.jobId, 'local-job-1');
  assert.equal(scheduledPolls[0]?.delayMs, 3000);
});

test('pollJob resubmits pending jobs without worker job id', async () => {
  const markSubmitErrors: Array<Record<string, unknown>> = [];
  const submittedJobs: Array<Record<string, unknown>> = [];
  const scheduledPolls: Array<{ jobId: string; delayMs?: number }> = [];
  const job = createJob();

  const service = new RecommendationGenerationOrchestratorService(
    {
      buildGenerationRequest: async () => { throw new Error('not used'); },
      generateForProfile: async () => { throw new Error('not used'); },
      applyWorkerResponse: async () => ({ profileId: 'profile-1', sourceKey: 'default', algorithmVersion: 'v3.2.1', historyGeneration: 12, sections: 0 }),
    } as never,
    {
      findById: async () => job,
      markSubmitted: async (_client: unknown, _jobId: string, params: Record<string, unknown>) => {
        submittedJobs.push(params);
      },
      markSubmitError: async (_client: unknown, _jobId: string, params: Record<string, unknown>) => {
        markSubmitErrors.push(params);
      },
    } as never,
    {
      submitGeneration: async () => ({
        jobId: 'worker-job-2',
        status: 'queued',
        idempotencyKey: job.idempotencyKey,
        acceptedAt: '2026-04-04T00:00:02.000Z',
        pollAfterSeconds: 4,
      }),
      getGenerationStatus: async () => { throw new Error('not used'); },
    } as never,
    NOOP_TRANSACTION,
    async (jobId, delayMs) => { scheduledPolls.push({ jobId, delayMs }); },
    { workerMode: 'async', pollDelayMs: 1500, maxPollDelayMs: 10_000 },
  );

  const result = await service.pollJob(job.id);

  assert.equal(result.status, 'queued');
  assert.equal(submittedJobs.length, 1);
  assert.equal(markSubmitErrors.length, 0);
  assert.equal(scheduledPolls.length, 1);
  assert.equal(scheduledPolls[0]?.delayMs, 4000);
});

test('pollJob persists worker success using stored request lineage', async () => {
  const markTerminalCalls: Array<Record<string, unknown>> = [];
  const appliedContexts: Array<Record<string, unknown>> = [];
  const job = createJob({ workerJobId: 'worker-job-3', status: 'running' });
  const workerResult = createWorkerResult();

  const service = new RecommendationGenerationOrchestratorService(
    {
      buildGenerationRequest: async () => { throw new Error('not used'); },
      generateForProfile: async () => { throw new Error('not used'); },
      applyWorkerResponse: async (context: Record<string, unknown>, response: Record<string, unknown>) => {
        appliedContexts.push({ ...context, response });
        return { profileId: 'profile-1', sourceKey: 'default', algorithmVersion: 'v3.2.1', historyGeneration: 12, sections: 0 };
      },
    } as never,
    {
      findById: async () => job,
      markTerminal: async (_client: unknown, _jobId: string, params: Record<string, unknown>) => {
        markTerminalCalls.push(params);
      },
      markPollError: async () => { throw new Error('not used'); },
    } as never,
    {
      submitGeneration: async () => { throw new Error('not used'); },
      getGenerationStatus: async () => ({
        jobId: 'worker-job-3',
        status: 'succeeded',
        idempotencyKey: job.idempotencyKey,
        startedAt: '2026-04-04T00:00:03.000Z',
        completedAt: '2026-04-04T00:01:00.000Z',
        result: workerResult,
      }),
    } as never,
    NOOP_TRANSACTION,
    async () => {},
    { workerMode: 'async', pollDelayMs: 1500, maxPollDelayMs: 10_000 },
  );

  const result = await service.pollJob(job.id);

  assert.equal(result.status, 'succeeded');
  assert.equal(appliedContexts.length, 1);
  assert.equal(appliedContexts[0]?.accountId, 'account-1');
  assert.equal(appliedContexts[0]?.profileId, 'profile-1');
  assert.equal(appliedContexts[0]?.historyGeneration, 12);
  assert.equal(appliedContexts[0]?.sourceCursor, 'cursor-1');
  assert.deepEqual(appliedContexts[0]?.response, workerResult);
  assert.equal(markTerminalCalls.length, 1);
  assert.equal(markTerminalCalls[0]?.status, 'succeeded');
});

test('reconcileDueJobs retries pending submissions and reschedules active polls', async () => {
  const recoverableJobs = [
    createJob({ id: 'pending-job', status: 'pending' }),
    createJob({ id: 'running-job', status: 'running', workerJobId: 'worker-job-4' }),
  ];
  const submittedJobs: Array<Record<string, unknown>> = [];
  const scheduledPolls: Array<{ jobId: string; delayMs?: number }> = [];

  const service = new RecommendationGenerationOrchestratorService(
    {
      buildGenerationRequest: async () => { throw new Error('not used'); },
      generateForProfile: async () => { throw new Error('not used'); },
      applyWorkerResponse: async () => ({ profileId: 'profile-1', sourceKey: 'default', algorithmVersion: 'v3.2.1', historyGeneration: 12, sections: 0 }),
    } as never,
    {
      listRecoverable: async () => recoverableJobs,
      markSubmitted: async (_client: unknown, _jobId: string, params: Record<string, unknown>) => {
        submittedJobs.push(params);
      },
      markSubmitError: async () => { throw new Error('not used'); },
    } as never,
    {
      submitGeneration: async (_payload: unknown, options: { idempotencyKey: string }) => ({
        jobId: `worker:${options.idempotencyKey}`,
        status: 'queued',
        idempotencyKey: options.idempotencyKey,
        acceptedAt: '2026-04-04T00:00:04.000Z',
        pollAfterSeconds: 6,
      }),
      getGenerationStatus: async () => { throw new Error('not used'); },
    } as never,
    NOOP_TRANSACTION,
    async (jobId, delayMs) => { scheduledPolls.push({ jobId, delayMs }); },
    { workerMode: 'async', pollDelayMs: 1500, maxPollDelayMs: 10_000 },
  );

  const result = await service.reconcileDueJobs(10);

  assert.equal(result.inspectedCount, 2);
  assert.equal(result.recoveredCount, 2);
  assert.equal(submittedJobs.length, 1);
  assert.equal(submittedJobs[0]?.workerJobId, 'worker:recommendation:profile-1:default:v3.2.1:12');
  assert.deepEqual(scheduledPolls, [
    { jobId: 'pending-job', delayMs: 6000 },
    { jobId: 'running-job', delayMs: 0 },
  ]);
});
