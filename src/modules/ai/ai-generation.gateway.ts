import { Job } from 'bullmq';
import { enqueueAiInsightsJob, getAiGenerationQueue, getAiGenerationQueueEvents } from '../../lib/queue.js';

export interface AiInsightsEnqueueParams {
  userId: string;
  profileId: string;
  itemId: string;
  contentId: string;
  locale: string;
  generationVersion: string;
}

export interface AiInsightsJobHandle {
  jobId: string;
}

/**
 * Seam between the request path and the AI-generation queue. Injected so the
 * service can be unit-tested without touching BullMQ/Redis. The default
 * implementation enqueues a deterministic-id, no-retry job and waits on its
 * completion (bounded by the caller's timeout).
 */
export interface AiGenerationGateway {
  enqueueInsights(params: AiInsightsEnqueueParams): Promise<AiInsightsJobHandle>;
  waitForInsights(handle: AiInsightsJobHandle, timeoutMs: number): Promise<void>;
}

export class BullMqAiGenerationGateway implements AiGenerationGateway {
  async enqueueInsights(params: AiInsightsEnqueueParams): Promise<AiInsightsJobHandle> {
    const job = await enqueueAiInsightsJob(params);
    return { jobId: job.id ?? '' };
  }

  async waitForInsights(handle: AiInsightsJobHandle, timeoutMs: number): Promise<void> {
    if (!handle.jobId) {
      return;
    }
    const job = await Job.fromId(getAiGenerationQueue(), handle.jobId);
    // Job already removed (completed+retained-for-none or failed+removed) — the
    // caller re-reads the cache and either serves it or surfaces a timeout.
    if (!job) {
      return;
    }
    // Ensure the events stream is actually being read before we depend on it;
    // otherwise the completion event can arrive before our reader attaches and
    // the wait would only resolve via the timeout.
    const queueEvents = getAiGenerationQueueEvents();
    await queueEvents.waitUntilReady();
    await job.waitUntilFinished(queueEvents, timeoutMs);
  }
}
