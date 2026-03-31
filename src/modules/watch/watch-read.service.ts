import { withDbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import { WatchDerivedItemBuilder } from './watch-derived-item-builder.service.js';
import type { HydratedWatchItem } from './watch-read.types.js';
import type { ContinueWatchingProductItem, WatchedProductItem } from './watch-derived-item.types.js';

export class WatchReadService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly metadataCardService = new MetadataCardService(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly watchDerivedItemBuilder = new WatchDerivedItemBuilder(),
  ) {}

  async listContinueWatching(userId: string, profileId: string, limit: number): Promise<HydratedWatchItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.continueWatchingRepository.list(client, profileId, limit);
      return Promise.all(
        rows.map(async (row) => {
          const media = await this.metadataCardService.buildCardViewFromRow(client, row);
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

  async listContinueWatchingProducts(userId: string, profileId: string, limit: number): Promise<ContinueWatchingProductItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.continueWatchingRepository.list(client, profileId, limit);
      return Promise.all(
        rows.map(async (row) => {
          const media = await this.metadataCardService.buildCardViewFromRow(client, row);
          const productItem = await this.watchDerivedItemBuilder.buildProductItem(client, media);
          return {
            ...productItem,
            id: String(row.id),
            progress: {
              positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
              durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
              progressPercent: Number(row.progress_percent ?? 0),
              lastPlayedAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
            },
            lastActivityAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
            origins: deriveOrigins((row.payload as Record<string, unknown> | undefined) ?? {}),
            dismissible: true,
          } satisfies ContinueWatchingProductItem;
        }),
      );
    });
  }

  async listWatched(userId: string, profileId: string, limit: number): Promise<HydratedWatchItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.watchHistoryRepository.list(client, profileId, limit);
      return Promise.all(
        rows.map(async (row) => {
          const media = await this.metadataCardService.buildCardViewFromRow(client, row);
          return {
            media,
            watchedAt: requireDbIsoString(row.watched_at as Date | string | null | undefined, 'watch_history.watched_at'),
            payload: (row.payload as Record<string, unknown> | undefined) ?? {},
          } satisfies HydratedWatchItem;
        }),
      );
    });
  }

  async listWatchedProducts(userId: string, profileId: string, limit: number): Promise<WatchedProductItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.watchHistoryRepository.list(client, profileId, limit);
      return Promise.all(
        rows.map(async (row) => {
          const media = await this.metadataCardService.buildCardViewFromRow(client, row);
          const productItem = await this.watchDerivedItemBuilder.buildProductItem(client, media);
          return {
            ...productItem,
            watchedAt: requireDbIsoString(row.watched_at as Date | string | null | undefined, 'watch_history.watched_at'),
            origins: deriveOrigins((row.payload as Record<string, unknown> | undefined) ?? {}),
          } satisfies WatchedProductItem;
        }),
      );
    });
  }
}

function deriveOrigins(payload: Record<string, unknown>): string[] {
  const provider = typeof payload.provider === 'string' && payload.provider.trim() ? payload.provider.trim() : null;
  if (provider === 'trakt') {
    return ['trakt_import'];
  }
  if (provider === 'simkl') {
    return ['simkl_import'];
  }
  return ['native'];
}
