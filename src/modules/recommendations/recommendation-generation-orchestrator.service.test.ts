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
    triggerSource: 'system',
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
    lastRequestedAt: '2026-04-04T00:00:00.000Z',
    lastSubmittedAt: null,
    lastPolledAt: null,
    lastSyncedAt: null,
    resultAppliedAt: null,
    applyErrorJson: {},
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
  const enqueuedSubmits: Array<{ jobId: string; delayMs: number | undefined }> = [];
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
      applyWorkerResponse: async () => ({ profileId: 'profile-1', sourceKey: 'default', algorithmVersion: 'v3.2.1', historyGeneration: 12, sections: 0 }),
    } as never,
    {
      findByGenerationKey: async () => null,
      create: async (_client: unknown, params: Record<string, unknown>) => {
        createdJobs.push(params);
        return job;
      },
      cancelSuperseded: async () => {},
    } as never,
    {
      submitGeneration: async () => { throw new Error('not used'); },
      getGenerationStatus: async () => { throw new Error('not used'); },
    } as never,
    NOOP_TRANSACTION,
    { queueDelayMs: 1500, pollDelayMs: 1500, maxPollDelayMs: 10_000 },
    {
      enqueueSubmit: async (jobId: string, delayMs?: number) => { enqueuedSubmits.push({ jobId, delayMs }); },
      enqueueSync: async () => { throw new Error('not used'); },
    },
  );

  const result = await service.ensureGeneration('profile-1', { triggerSource: 'admin_manual' });

  assert.equal(result.jobId, 'local-job-1');
  assert.equal(result.status, 'pending');
  assert.equal(result.created, true);
  assert.equal(createdJobs.length, 1);
  assert.equal(createdJobs[0]?.triggerSource, 'admin_manual');
  assert.deepEqual(enqueuedSubmits, [{ jobId: 'local-job-1', delayMs: 1500 }]);
});

test('syncQueuedJob submits pending tracked jobs without worker job id', async () => {
  const enqueuedSubmits: Array<Record<string, unknown>> = [];
  const job = createJob();

  const service = new RecommendationGenerationOrchestratorService(
    {
      buildGenerationRequest: async () => { throw new Error('not used'); },
      applyWorkerResponse: async () => ({ profileId: 'profile-1', sourceKey: 'default', algorithmVersion: 'v3.2.1', historyGeneration: 12, sections: 0 }),
    } as never,
    {
      findById: async () => job,
    } as never,
    {
      submitGeneration: async () => { throw new Error('not used'); },
      getGenerationStatus: async () => { throw new Error('not used'); },
    } as never,
    NOOP_TRANSACTION,
    { queueDelayMs: 1500, pollDelayMs: 1500, maxPollDelayMs: 10_000 },
    {
      enqueueSubmit: async (jobId: string, delayMs?: number) => { enqueuedSubmits.push({ jobId, delayMs }); },
      enqueueSync: async () => { throw new Error('not used'); },
    },
  );

  await service.syncQueuedJob(job.id);

  assert.deepEqual(enqueuedSubmits, [{ jobId: job.id, delayMs: undefined }]);
});

test('syncQueuedJob persists worker success using stored request lineage', async () => {
  const markTerminalCalls: Array<Record<string, unknown>> = [];
  const appliedContexts: Array<Record<string, unknown>> = [];
  const job = createJob({ workerJobId: 'worker-job-3', status: 'running' });
  const workerResult = createWorkerResult();

  const service = new RecommendationGenerationOrchestratorService(
    {
      buildGenerationRequest: async () => ({
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
      }),
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
      markResultApplied: async () => {},
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
    { queueDelayMs: 1500, pollDelayMs: 1500, maxPollDelayMs: 10_000 },
    {
      enqueueSubmit: async () => { throw new Error('not used'); },
      enqueueSync: async () => { throw new Error('not used'); },
    },
  );

  await service.syncQueuedJob(job.id);

  assert.equal(appliedContexts.length, 1);
  assert.equal(appliedContexts[0]?.accountId, 'account-1');
  assert.equal(appliedContexts[0]?.profileId, 'profile-1');
  assert.equal(appliedContexts[0]?.historyGeneration, 12);
  assert.equal(appliedContexts[0]?.sourceCursor, 'cursor-1');
  assert.deepEqual(appliedContexts[0]?.response, workerResult);
  assert.equal(markTerminalCalls.length, 1);
  assert.equal(markTerminalCalls[0]?.status, 'succeeded');
});

test('submitQueuedJob handles immediate terminal submit without transient queued state', async () => {
  const submittedJobs: Array<Record<string, unknown>> = [];
  const markTerminalCalls: Array<Record<string, unknown>> = [];
  const appliedContexts: Array<Record<string, unknown>> = [];
  const job = createJob();
  const workerResult = createWorkerResult();

  const service = new RecommendationGenerationOrchestratorService(
    {
      buildGenerationRequest: async () => ({
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
      }),
      applyWorkerResponse: async (context: Record<string, unknown>, response: Record<string, unknown>) => {
        appliedContexts.push({ ...context, response });
        return { profileId: 'profile-1', sourceKey: 'default', algorithmVersion: 'v3.2.1', historyGeneration: 12, sections: 0 };
      },
    } as never,
    {
      findById: async () => job,
      markSubmitted: async (_client: unknown, _jobId: string, params: Record<string, unknown>) => {
        submittedJobs.push(params);
      },
      markTerminal: async (_client: unknown, _jobId: string, params: Record<string, unknown>) => {
        markTerminalCalls.push(params);
      },
      markResultApplied: async () => {},
      markSubmitError: async () => { throw new Error('not used'); },
    } as never,
    {
      submitGeneration: async () => ({
        jobId: 'worker-job-immediate-success',
        status: 'succeeded',
        idempotencyKey: job.idempotencyKey,
        acceptedAt: '2026-04-04T00:00:02.000Z',
        pollAfterSeconds: 4,
      }),
      getGenerationStatus: async () => ({
        jobId: 'worker-job-immediate-success',
        status: 'succeeded',
        idempotencyKey: job.idempotencyKey,
        startedAt: '2026-04-04T00:00:03.000Z',
        completedAt: '2026-04-04T00:01:00.000Z',
        result: workerResult,
      }),
    } as never,
    NOOP_TRANSACTION,
    { queueDelayMs: 1500, pollDelayMs: 1500, maxPollDelayMs: 10_000 },
    {
      enqueueSubmit: async () => { throw new Error('not used'); },
      enqueueSync: async () => { throw new Error('not used'); },
    },
  );

  await service.submitQueuedJob(job.id);

  assert.equal(submittedJobs.length, 1);
  assert.equal(submittedJobs[0]?.status, 'succeeded');
  assert.equal(markTerminalCalls.length, 1);
  assert.equal(markTerminalCalls[0]?.status, 'succeeded');
  assert.equal(appliedContexts.length, 1);
});

test('syncQueuedJob reapplies succeeded jobs that are missing local resultAppliedAt', async () => {
  const appliedContexts: Array<Record<string, unknown>> = [];
  const markedApplied: Array<Record<string, unknown>> = [];
  const job = createJob({
    workerJobId: 'worker-job-5',
    status: 'succeeded',
    resultAppliedAt: null,
    lastStatusPayload: {
      jobId: 'worker-job-5',
      status: 'succeeded',
      result: createWorkerResult(),
    },
  });

  const service = new RecommendationGenerationOrchestratorService(
    {
      buildGenerationRequest: async () => { throw new Error('not used'); },
      applyWorkerResponse: async (context: Record<string, unknown>, response: Record<string, unknown>) => {
        appliedContexts.push({ ...context, response });
        return { profileId: 'profile-1', sourceKey: 'default', algorithmVersion: 'v3.2.1', historyGeneration: 12, sections: 0 };
      },
    } as never,
    {
      findById: async () => job,
      markResultApplied: async (_client: unknown, _jobId: string, params?: Record<string, unknown>) => {
        markedApplied.push(params ?? {});
      },
      markApplyError: async () => { throw new Error('not used'); },
    } as never,
    {
      submitGeneration: async () => { throw new Error('not used'); },
      getGenerationStatus: async () => { throw new Error('not used'); },
    } as never,
    NOOP_TRANSACTION,
    { queueDelayMs: 1500, pollDelayMs: 1500, maxPollDelayMs: 10_000 },
    {
      enqueueSubmit: async () => { throw new Error('not used'); },
      enqueueSync: async () => { throw new Error('not used'); },
    },
  );

  await service.syncQueuedJob(job.id);

  assert.equal(appliedContexts.length, 1);
  assert.equal(appliedContexts[0]?.accountId, 'account-1');
  assert.equal(markedApplied.length, 1);
});

test('enqueueRecoveryJobs enqueues submit and sync recovery work for tracked jobs', async () => {
  const recoverableJobs = [
    createJob({ id: 'pending-job', status: 'pending' }),
    createJob({ id: 'running-job', status: 'running', workerJobId: 'worker-job-4' }),
  ];
  const enqueuedSubmits: string[] = [];
  const enqueuedSyncs: string[] = [];

  const service = new RecommendationGenerationOrchestratorService(
    {
      buildGenerationRequest: async () => { throw new Error('not used'); },
      applyWorkerResponse: async () => ({ profileId: 'profile-1', sourceKey: 'default', algorithmVersion: 'v3.2.1', historyGeneration: 12, sections: 0 }),
    } as never,
    {
      listRecoveryCandidates: async () => recoverableJobs,
    } as never,
    {
      submitGeneration: async () => { throw new Error('not used'); },
      getGenerationStatus: async () => { throw new Error('not used'); },
    } as never,
    NOOP_TRANSACTION,
    { queueDelayMs: 1500, pollDelayMs: 1500, maxPollDelayMs: 10_000 },
    {
      enqueueSubmit: async (jobId: string) => { enqueuedSubmits.push(jobId); },
      enqueueSync: async (jobId: string) => { enqueuedSyncs.push(jobId); },
    },
  );

  const result = await service.enqueueRecoveryJobs(10);

  assert.equal(result.enqueuedCount, 2);
  assert.deepEqual(enqueuedSubmits, ['pending-job']);
  assert.deepEqual(enqueuedSyncs, ['running-job']);
});
