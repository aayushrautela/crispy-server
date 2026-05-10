import { env } from '../../config/env.js';
import { logger as defaultLogger } from '../../config/logger.js';
import { AdminBulkJobWorker } from './admin-bulk-job-worker.js';

type WorkerLogger = Pick<typeof defaultLogger, 'debug' | 'error' | 'info' | 'warn'>;
type AdminBulkJobsWorker = Pick<AdminBulkJobWorker, 'processNextJob'>;

export type AdminBulkJobsWorkerRuntime = {
  start: () => void;
  stop: () => Promise<void>;
  isRunning: () => boolean;
};

export type AdminBulkJobsWorkerRuntimeOptions = {
  worker?: AdminBulkJobsWorker;
  logger?: WorkerLogger;
  pollIntervalMs?: number;
  pollJitterMs?: number;
  shutdownTimeoutMs?: number;
  maxConcurrentJobs?: number;
};

function normalizeNonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function jitteredDelay(baseMs: number, jitterMs: number): number {
  if (jitterMs <= 0) {
    return baseMs;
  }

  return baseMs + Math.floor(Math.random() * (jitterMs + 1));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve('timeout'), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch((error: unknown) => reject(error))
      .finally(() => clearTimeout(timeout));
  });
}

export function createAdminBulkJobsWorkerRuntime(
  options: AdminBulkJobsWorkerRuntimeOptions = {},
): AdminBulkJobsWorkerRuntime {
  const worker = options.worker ?? new AdminBulkJobWorker();
  const runtimeLogger = options.logger ?? defaultLogger;
  const pollIntervalMs = normalizeNonNegative(options.pollIntervalMs ?? env.adminBulkJobsPollIntervalMs, 5000);
  const pollJitterMs = normalizeNonNegative(options.pollJitterMs ?? env.adminBulkJobsPollJitterMs, 1000);
  const shutdownTimeoutMs = normalizeNonNegative(options.shutdownTimeoutMs ?? env.adminBulkJobsShutdownTimeoutMs, 30000);
  const maxConcurrentJobs = normalizePositiveInteger(options.maxConcurrentJobs ?? env.adminBulkJobsMaxConcurrentJobs, 1);

  let running = false;
  let stopping = false;
  let loopPromise: Promise<void> | null = null;
  let sleepTimeout: NodeJS.Timeout | null = null;
  let wakeSleep: (() => void) | null = null;

  function sleep(ms: number): Promise<void> {
    if (ms <= 0 || stopping) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      wakeSleep = resolve;
      sleepTimeout = setTimeout(() => {
        sleepTimeout = null;
        wakeSleep = null;
        resolve();
      }, ms);
    });
  }

  function wake(): void {
    if (sleepTimeout) {
      clearTimeout(sleepTimeout);
      sleepTimeout = null;
    }

    if (wakeSleep) {
      const resolve = wakeSleep;
      wakeSleep = null;
      resolve();
    }
  }

  async function processBatch(): Promise<boolean> {
    const results = await Promise.allSettled(
      Array.from({ length: maxConcurrentJobs }, () => worker.processNextJob()),
    );

    let processed = false;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        processed = processed || result.value.processed;
        if (result.value.processed) {
          runtimeLogger.info({ jobId: result.value.jobId }, 'admin bulk job worker processed job');
        }
      } else {
        runtimeLogger.error({ err: result.reason }, 'admin bulk job worker failed to process job');
      }
    }

    return processed;
  }

  async function runLoop(): Promise<void> {
    runtimeLogger.info(
      { pollIntervalMs, pollJitterMs, maxConcurrentJobs },
      'admin bulk jobs worker runtime started',
    );

    while (!stopping) {
      const processed = await processBatch();
      if (!processed) {
        await sleep(jitteredDelay(pollIntervalMs, pollJitterMs));
      }
    }

    running = false;
    runtimeLogger.info('admin bulk jobs worker runtime stopped');
  }

  return {
    start(): void {
      if (running) {
        return;
      }

      stopping = false;
      running = true;
      loopPromise = runLoop().catch((error: unknown) => {
        running = false;
        stopping = false;
        runtimeLogger.error({ err: error }, 'admin bulk jobs worker runtime crashed');
      });
    },

    async stop(): Promise<void> {
      if (!running || !loopPromise) {
        stopping = true;
        wake();
        return;
      }

      stopping = true;
      wake();
      const result = await withTimeout(loopPromise, shutdownTimeoutMs);
      if (result === 'timeout') {
        running = false;
        runtimeLogger.warn({ shutdownTimeoutMs }, 'admin bulk jobs worker runtime shutdown timed out');
      }
    },

    isRunning(): boolean {
      return running;
    },
  };
}
