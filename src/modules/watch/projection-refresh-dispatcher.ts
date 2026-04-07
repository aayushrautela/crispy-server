import { logger } from '../../config/logger.js';

type ProjectionRefreshQueue = {
  enqueueRefreshCalendarCache: (profileId: string) => Promise<void>;
  enqueueMetadataRefresh: (profileId: string, mediaKey?: string) => Promise<void>;
};

const defaultQueue: ProjectionRefreshQueue = {
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

  async invalidateCalendar(profileId: string): Promise<void> {
    try {
      await this.queue.enqueueRefreshCalendarCache(profileId);
    } catch (error) {
      this.log.warn(
        {
          err: error,
          profileId,
        },
        'failed to enqueue calendar refresh job',
      );
    }
  }

  async refreshMetadata(profileId: string, mediaKey?: string): Promise<void> {
    try {
      await this.queue.enqueueMetadataRefresh(profileId, mediaKey);
    } catch (error) {
      this.log.warn(
        {
          err: error,
          profileId,
          mediaKey,
        },
        'failed to enqueue metadata refresh job',
      );
    }
  }
}
