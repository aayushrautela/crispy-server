import test from 'node:test';
import assert from 'node:assert/strict';
import type { AdminBulkJobWorker } from './admin-bulk-job-worker.js';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  AUTH_BASE_URL: 'http://localhost:54321',
  AUTH_ADMIN_API_KEY: 'test-service-role-key',
  JWT_SECRET: 'test-jwt-secret',
});

let createAdminBulkJobsWorkerRuntime: typeof import('./worker-runtime.js').createAdminBulkJobsWorkerRuntime;

test.before(async () => {
  ({ createAdminBulkJobsWorkerRuntime } = await import('./worker-runtime.js'));
});

type ProcessResult = { processed: boolean; jobId?: string };

function createMockWorker(processResults: ProcessResult[] = []): AdminBulkJobWorker {
  let callIndex = 0;
  return {
    processNextJob: async () => {
      const result = processResults[callIndex] ?? { processed: false };
      callIndex++;
      return result;
    },
  } as AdminBulkJobWorker;
}

function createMockLogger() {
  const logs: Array<{ level: string; message: string; context?: unknown }> = [];
  const pushLog = (level: string, ...args: unknown[]) => {
    const message = typeof args.at(-1) === 'string' ? String(args.at(-1)) : '';
    const context = args.length > 1 ? args[0] : undefined;
    logs.push({ level, message, context });
  };
  return {
    debug: (...args: unknown[]) => pushLog('debug', ...args),
    info: (...args: unknown[]) => pushLog('info', ...args),
    warn: (...args: unknown[]) => pushLog('warn', ...args),
    error: (...args: unknown[]) => pushLog('error', ...args),
    logs,
  };
}

test('worker runtime starts and stops idempotently', async (t) => {
  const worker = createMockWorker([{ processed: false }]);
  const logger = createMockLogger();
  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    logger,
    pollIntervalMs: 50,
    pollJitterMs: 0,
  });

  assert.equal(runtime.isRunning(), false, 'should not be running initially');

  runtime.start();
  assert.equal(runtime.isRunning(), true, 'should be running after start');

  // Start again - should be idempotent
  runtime.start();
  assert.equal(runtime.isRunning(), true, 'should still be running after second start');

  await runtime.stop();
  assert.equal(runtime.isRunning(), false, 'should not be running after stop');

  // Stop again - should be idempotent
  await runtime.stop();
  assert.equal(runtime.isRunning(), false, 'should still not be running after second stop');

  const startLogs = logger.logs.filter((log) => log.message.includes('started'));
  assert.equal(startLogs.length, 1, 'should only log start once');
});

test('worker runtime stop prevents future ticks', async (t) => {
  let processCallCount = 0;
  const worker = {
    processNextJob: async () => {
      processCallCount++;
      return { processed: false };
    },
  } as AdminBulkJobWorker;

  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    pollIntervalMs: 20,
    pollJitterMs: 0,
  });

  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await runtime.stop();

  const callsAfterStop = processCallCount;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const callsAfterWait = processCallCount;

  assert.equal(callsAfterStop, callsAfterWait, 'should not process more jobs after stop');
});

test('worker runtime process errors do not crash loop', async (t) => {
  let callCount = 0;
  const worker = {
    processNextJob: async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('simulated process error');
      }
      return { processed: false };
    },
  } as AdminBulkJobWorker;

  const logger = createMockLogger();
  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    logger,
    pollIntervalMs: 20,
    pollJitterMs: 0,
  });

  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 60));
  await runtime.stop();

  assert.ok(callCount >= 2, 'should continue processing after error');
  const errorLogs = logger.logs.filter((log) => log.level === 'error' && log.message.includes('failed to process job'));
  assert.equal(errorLogs.length, 1, 'should log the error');
});

test('worker runtime processes jobs continuously when work is available', async (t) => {
  const processResults: ProcessResult[] = [
    { processed: true, jobId: 'job-1' },
    { processed: true, jobId: 'job-2' },
    { processed: true, jobId: 'job-3' },
    { processed: false },
  ];

  const worker = createMockWorker(processResults);
  const logger = createMockLogger();
  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    logger,
    pollIntervalMs: 100,
    pollJitterMs: 0,
  });

  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await runtime.stop();

  const jobLogs = logger.logs.filter((log) => log.message.includes('processed job'));
  assert.ok(jobLogs.length >= 3, 'should process multiple jobs without delay when work is available');
});

test('worker runtime waits between polls when no work is available', async (t) => {
  let callCount = 0;
  const worker = {
    processNextJob: async () => {
      callCount++;
      return { processed: false };
    },
  } as AdminBulkJobWorker;

  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    pollIntervalMs: 50,
    pollJitterMs: 0,
  });

  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const callsAfterShortWait = callCount;
  await new Promise((resolve) => setTimeout(resolve, 40));
  await runtime.stop();

  assert.ok(callsAfterShortWait < callCount, 'should poll again after interval');
  assert.ok(callCount <= 3, 'should not poll too frequently');
});

test('worker runtime respects maxConcurrentJobs', async (t) => {
  let maxConcurrentCalls = 0;
  let currentConcurrentCalls = 0;

  const worker = {
    processNextJob: async () => {
      currentConcurrentCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, currentConcurrentCalls);
      await new Promise((resolve) => setTimeout(resolve, 20));
      currentConcurrentCalls--;
      return { processed: true, jobId: `job-${Date.now()}` };
    },
  } as AdminBulkJobWorker;

  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    maxConcurrentJobs: 3,
    pollIntervalMs: 100,
    pollJitterMs: 0,
  });

  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await runtime.stop();

  assert.equal(maxConcurrentCalls, 3, 'should respect maxConcurrentJobs limit');
});

test('worker runtime normalizes invalid configuration values', async (t) => {
  const worker = createMockWorker([{ processed: false }]);
  const logger = createMockLogger();

  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    logger,
    pollIntervalMs: -100,
    pollJitterMs: -50,
    maxConcurrentJobs: 0,
    shutdownTimeoutMs: -1000,
  });

  runtime.start();
  assert.equal(runtime.isRunning(), true, 'should start with normalized values');
  await runtime.stop();
  assert.equal(runtime.isRunning(), false, 'should stop cleanly');
});

test('worker runtime applies jitter to poll interval', async (t) => {
  let callCount = 0;
  const worker = {
    processNextJob: async () => {
      callCount++;
      return { processed: false };
    },
  } as AdminBulkJobWorker;

  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    pollIntervalMs: 50,
    pollJitterMs: 20,
  });

  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await runtime.stop();

  // With jitter, timing should vary but still poll multiple times
  assert.ok(callCount >= 2, 'should poll multiple times with jitter');
  assert.ok(callCount <= 5, 'jitter should not cause excessive polling');
});

test('worker runtime shutdown timeout prevents hanging', async (t) => {
  const worker = {
    processNextJob: async () => {
      // Simulate a long-running job
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { processed: true, jobId: 'slow-job' };
    },
  } as AdminBulkJobWorker;

  const logger = createMockLogger();
  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    logger,
    pollIntervalMs: 10,
    pollJitterMs: 0,
    shutdownTimeoutMs: 50,
  });

  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const stopStart = Date.now();
  await runtime.stop();
  const stopDuration = Date.now() - stopStart;

  assert.ok(stopDuration < 100, 'should timeout and not wait indefinitely');
  const timeoutLogs = logger.logs.filter((log) => log.message.includes('shutdown timed out'));
  assert.equal(timeoutLogs.length, 1, 'should log timeout warning');
});

test('worker runtime logs job processing success', async (t) => {
  const worker = createMockWorker([
    { processed: true, jobId: 'job-123' },
    { processed: false },
  ]);
  const logger = createMockLogger();

  const runtime = createAdminBulkJobsWorkerRuntime({
    worker,
    logger,
    pollIntervalMs: 20,
    pollJitterMs: 0,
  });

  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await runtime.stop();

  const jobLogs = logger.logs.filter((log) => log.message.includes('processed job'));
  assert.equal(jobLogs.length, 1, 'should log successful job processing');
  assert.equal((jobLogs[0]?.context as { jobId?: string })?.jobId, 'job-123', 'should include job ID in log');
});
