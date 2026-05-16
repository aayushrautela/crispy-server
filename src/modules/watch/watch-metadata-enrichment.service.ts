import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import type { MediaItem } from '../metadata/media-item.types.js';
import { watchCacheRecordToMediaItem } from '../metadata/media-item.mapper.js';
import type { WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';
import { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import { WatchCacheMissRefreshService } from './watch-cache-miss-refresh.service.js';
import type {
  ContinueWatchingProductItem,
  HistoryProductItem,
  RatingProductItem,
  WatchlistProductItem,
} from './watch-derived-item.types.js';
import type { WatchStateResponse } from './watch-read.types.js';

type RegularMediaItem = HistoryProductItem | WatchlistProductItem | RatingProductItem | WatchStateResponse;

type CacheMissRefreshDependency = Pick<WatchCacheMissRefreshService, 'refreshMissingCardsAndReturnRecords'>;

export class WatchMetadataEnrichmentService {
  constructor(
    private readonly watchMediaCardCacheService = new WatchMediaCardCacheService(),
    private readonly cacheMissRefreshService: CacheMissRefreshDependency = new WatchCacheMissRefreshService(),
  ) {}

  async enrichContinueWatchingItems(
    client: DbClient,
    items: ContinueWatchingProductItem[],
    language?: string | null,
  ): Promise<ContinueWatchingProductItem[]> {
    const mediaKeys = items.map((item) => item.mediaItem.mediaKey);
    const parentKeys = items
      .map((item) => item.mediaItem.parent?.mediaKey)
      .filter((k): k is string => !!k);
    const allKeys = [...new Set([...mediaKeys, ...parentKeys])];
    const records = await this.loadRecords(client, allKeys, language);

    return items.reduce<ContinueWatchingProductItem[]>((acc, item) => {
      const record = records.get(item.mediaItem.mediaKey);
      if (!record) {
        return acc;
      }

      const parentKey = item.mediaItem.parent?.mediaKey;
      const parentRecord = parentKey ? records.get(parentKey) : undefined;

      if (item.mediaItem.mediaType === 'episode' && !parentRecord) {
        return acc;
      }

      const enriched = mergeEnrichedMediaItem(record, item.mediaItem);

      if (parentRecord && enriched.parent) {
        enriched.parent = { ...enriched.parent, title: parentRecord.title };
      }

      return acc.concat([{ ...item, mediaItem: enriched }]);
    }, []);
  }

  async enrichRegularMediaItems<TItem extends RegularMediaItem>(client: DbClient, items: TItem[], language?: string | null): Promise<TItem[]> {
    const records = await this.loadRecords(client, items.map((item) => item.mediaItem.mediaKey), language);
    return items.map((item) => {
      const record = records.get(item.mediaItem.mediaKey);
      if (!record) {
        return item;
      }
      return {
        ...item,
        mediaItem: mergeEnrichedMediaItem(record, item.mediaItem),
      };
    });
  }

  private async loadRecords(client: DbClient, mediaKeys: string[], language?: string | null): Promise<Map<string, WatchMediaCardCacheRecord>> {
    const uniqueMediaKeys = [...new Set(mediaKeys.filter((mediaKey) => mediaKey.trim()))];
    if (!uniqueMediaKeys.length) {
      return new Map();
    }

    const records = await this.watchMediaCardCacheService.listCardCacheRecords(client, uniqueMediaKeys, language);
    const missingCount = uniqueMediaKeys.length - records.size;
    if (missingCount > 0) {
      const missingKeys = uniqueMediaKeys.filter((key) => !records.has(key));
      logger.debug({ requestedCount: uniqueMediaKeys.length, hitCount: records.size, missingCount }, 'watch metadata cache misses');
      const refreshedRecords = await this.cacheMissRefreshService.refreshMissingCardsAndReturnRecords(client, missingKeys, language);
      for (const [key, record] of refreshedRecords.entries()) {
        records.set(key, record);
      }
    }
    return records;
  }
}

function mergeEnrichedMediaItem(record: WatchMediaCardCacheRecord, existing: MediaItem): MediaItem {
  const enriched = watchCacheRecordToMediaItem(record);
  return {
    ...enriched,
    originalTitle: existing.originalTitle,
    overview: existing.overview,
    images: {
      ...enriched.images,
      still: existing.images.still.small ? existing.images.still : enriched.images.still,
    },
    releaseDate: existing.releaseDate,
    genres: enriched.genres,
    runtimeMinutes: existing.runtimeMinutes,
    status: existing.status,
    trailerUrl: enriched.trailerUrl,
    trailerThumbnailUrl: enriched.trailerThumbnailUrl,
    posterColor: enriched.posterColor,
    backdropColor: enriched.backdropColor,
    externalIds: existing.externalIds,
    parent: existing.parent,
    showTmdbId: existing.showTmdbId,
    seasonNumber: existing.seasonNumber,
    episodeNumber: existing.episodeNumber,
    absoluteEpisodeNumber: existing.absoluteEpisodeNumber,
    episodeTitle: existing.episodeTitle,
    airDate: existing.airDate,
  };
}
