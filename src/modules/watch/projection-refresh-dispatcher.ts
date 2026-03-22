import { logger } from '../../config/logger.js';

type ProjectionRefreshQueue = {
  enqueueRefreshHomeCache: (profileId: string) => Promise<void>;
  enqueueRefreshCalendarCache: (profileId: string) => Promise<void>;
  enqueueMetadataRefresh: (profileId: string, mediaKey?: string) => Promise<void>;
};

const defaultQueue: ProjectionRefreshQueue = {
  enqueueRefreshHomeCache: async (profileId) => {
    const { enqueueRefreshHomeCache } = await import('../../lib/queue.js');
    await enqueueRefreshHomeCache(profileId);
  },
  enqueueRefreshCalendarCache: async (profileId) => {
    const { enqueueRefreshCalendarCache } = await import('../../lib/queue.js');
    await enqueueRefreshCalendarCache(profileId);
  },
  enqueueMetadataRefresh: async (profileId, mediaKey) => {
    const { enqueueMetadataRefresh } = await import('../../lib/queue.js');
    await enqueueMetadataRefresh(profileId, mediaKey);
  },
};

export class ProjectionRefreshDispatcher {
  constructor(
    private readonly log: Pick<typeof logger, 'warn'> = logger,
    private readonly queue: ProjectionRefreshQueue = defaultQueue,
  ) {}

  async notifyProfileChanged(profileId: string, options?: { mediaKey?: string; refreshMetadata?: boolean }): Promise<void> {
    try {
      const work: Promise<void>[] = [
        this.queue.enqueueRefreshHomeCache(profileId),
        this.queue.enqueueRefreshCalendarCache(profileId),
      ];
      if (options?.refreshMetadata !== false && options?.mediaKey) {
        work.push(this.queue.enqueueMetadataRefresh(profileId, options.mediaKey));
      }
      await Promise.all(work);
    } catch (error) {
      this.log.warn(
        {
          err: error,
          profileId,
          mediaKey: options?.mediaKey,
          refreshMetadata: options?.refreshMetadata ?? true,
        },
        'failed to enqueue projection refresh jobs',
      );
    }
  }
}
