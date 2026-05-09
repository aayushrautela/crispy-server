import { logger } from '../../config/logger.js';
import { withDbClient } from '../../lib/db.js';
import { RecommenderOutboxClient } from './recommender-outbox.client.js';
import { ServiceOutboxRepository, type ServiceOutboxEventRecord } from './service-outbox.repo.js';

export type OutboxDispatcherOptions = {
  batchSize: number;
  intervalMs: number;
  lockSeconds: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
};

type DispatchOutcome = 'dispatched' | 'failed' | 'retry';

export class OutboxDispatcher {
  private readonly repository = new ServiceOutboxRepository();
  private readonly client = new RecommenderOutboxClient();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly options: OutboxDispatcherOptions) {}

  start(): void {
    if (this.stopped) {
      return;
    }

    this.schedule(0);
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private schedule(delayMs = this.options.intervalMs): void {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) {
      this.schedule();
      return;
    }

    this.running = true;
    try {
      await this.dispatchBatch();
    } catch (error) {
      logger.error({ err: error }, 'outbox dispatcher tick failed');
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private async dispatchBatch(): Promise<void> {
    const lockUntil = new Date(Date.now() + this.options.lockSeconds * 1000).toISOString();
    const events = await withDbClient(async (client) => {
      const released = await this.repository.releaseStaleProcessing(client, this.options.batchSize);
      if (released.length > 0) {
        logger.info({ count: released.length }, 'released stale outbox events');
      }

      return this.repository.claimDuePending(client, {
        destination: 'recommender',
        limit: this.options.batchSize,
        lockUntil,
      });
    });

    if (events.length === 0) {
      return;
    }

    logger.info({ count: events.length }, 'claimed outbox events');

    for (const event of events) {
      await this.dispatchEvent(event);
    }
  }

  private async dispatchEvent(event: ServiceOutboxEventRecord): Promise<void> {
    const outcome = await this.sendEvent(event);

    await withDbClient(async (client) => {
      if (outcome === 'dispatched') {
        await this.repository.markDispatched(client, event.id);
        logger.info({ eventId: event.id, eventType: event.eventType, attemptCount: event.attemptCount }, 'outbox event dispatched');
        return;
      }

      if (outcome === 'failed' || event.attemptCount >= this.options.maxAttempts) {
        await this.repository.markFailed(client, event.id);
        logger.warn({ eventId: event.id, eventType: event.eventType, attemptCount: event.attemptCount }, 'outbox event failed permanently');
        return;
      }

      const nextAttemptAt = this.computeNextAttemptAt(event.attemptCount);
      await this.repository.markFailedForRetry(client, { id: event.id, nextAttemptAt });
      logger.warn({ eventId: event.id, eventType: event.eventType, attemptCount: event.attemptCount, nextAttemptAt }, 'outbox event scheduled for retry');
    });
  }

  private async sendEvent(event: ServiceOutboxEventRecord): Promise<DispatchOutcome> {
    try {
      const result = await this.client.postEvent(event);
      const status = result.status;

      logger.info({ eventId: event.id, eventType: event.eventType, status }, 'outbox event post completed');

      if ((status >= 200 && status < 300) || status === 409) {
        return 'dispatched';
      }

      if ([400, 401, 403].includes(status)) {
        return 'failed';
      }

      if (status >= 500) {
        return 'retry';
      }

      return 'failed';
    } catch (error) {
      logger.warn({ err: error, eventId: event.id, eventType: event.eventType }, 'outbox event post failed');
      return 'retry';
    }
  }

  private computeNextAttemptAt(attemptCount: number): string {
    const exponent = Math.max(0, attemptCount - 1);
    const delayMs = Math.min(this.options.retryBaseMs * 2 ** exponent, this.options.retryMaxMs);
    return new Date(Date.now() + delayMs).toISOString();
  }
}
