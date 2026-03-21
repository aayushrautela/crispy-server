import { logger } from '../../config/logger.js';
import { enqueueMetadataRefresh, enqueueRefreshCalendarCache, enqueueRefreshHomeCache } from '../../lib/queue.js';

export class ProjectionRefreshDispatcher {
  async notifyProfileChanged(profileId: string, options?: { mediaKey?: string; refreshMetadata?: boolean }): Promise<void> {
    try {
      const work: Promise<void>[] = [enqueueRefreshHomeCache(profileId), enqueueRefreshCalendarCache(profileId)];
      if (options?.refreshMetadata !== false && options?.mediaKey) {
        work.push(enqueueMetadataRefresh(profileId, options.mediaKey));
      }
      await Promise.all(work);
    } catch (error) {
      logger.warn(
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
