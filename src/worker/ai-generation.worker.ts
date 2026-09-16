import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { aiGenerationQueueName, bullConnection, type AiInsightsJob } from '../lib/queue.js';
import { runAiInsightsJob } from './jobs/ai-insights.job.js';

export function startAiGenerationWorker(): Worker {
  return new Worker<AiInsightsJob>(
    aiGenerationQueueName,
    async (job) => {
      await runAiInsightsJob(job.data);
    },
    {
      connection: bullConnection,
      // Cap concurrent LLM calls so the provider is never overwhelmed. The
      // `maxStalledCount: 0` is the no-retry guarantee: a stalled/failed job is
      // failed once (and removed), never re-run or doubled.
      concurrency: env.aiWorkerConcurrency,
      maxStalledCount: 0,
    },
  );
}
