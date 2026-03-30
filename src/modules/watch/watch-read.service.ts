import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { requireDbIsoString } from '../../lib/time.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import type { HydratedWatchItem } from './watch-read.types.js';

export class WatchReadService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly metadataViewService = new MetadataViewService(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
  ) {}

  async listContinueWatching(userId: string, profileId: string, limit: number): Promise<HydratedWatchItem[]> {
    return withDbClient(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const rows = await this.continueWatchingRepository.list(client, profileId, limit);
      return Promise.all(
        rows.map(async (row) => {
          const media = await this.metadataViewService.buildMetadataCardViewFromRow(client, row);
          return {
            id: String(row.id),
            media,
            progress: {
              positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
              durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
              progressPercent: Number(row.progress_percent ?? 0),
              lastPlayedAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
            },
            lastActivityAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
            payload: (row.payload as Record<string, unknown> | undefined) ?? {},
          } satisfies HydratedWatchItem;
        }),
      );
    });
  }

  async listWatched(userId: string, profileId: string, limit: number): Promise<HydratedWatchItem[]> {
    return withDbClient(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const rows = await this.watchHistoryRepository.list(client, profileId, limit);
      return Promise.all(
        rows.map(async (row) => {
          const media = await this.metadataViewService.buildMetadataCardViewFromRow(client, row);
          return {
            media,
            watchedAt: requireDbIsoString(row.watched_at as Date | string | null | undefined, 'watch_history.watched_at'),
            payload: (row.payload as Record<string, unknown> | undefined) ?? {},
          } satisfies HydratedWatchItem;
        }),
      );
    });
  }
}
