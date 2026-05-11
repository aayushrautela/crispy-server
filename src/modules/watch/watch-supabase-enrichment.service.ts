import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import type { RegularCardView } from '../metadata/metadata-card.types.js';
import type { WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';
import { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import type {
  ContinueWatchingProductItem,
  HistoryProductItem,
  RatingProductItem,
  WatchlistProductItem,
} from './watch-derived-item.types.js';
import type { WatchStateResponse } from './watch-read.types.js';

type RegularMediaItem = HistoryProductItem | WatchlistProductItem | RatingProductItem | WatchStateResponse;

export class WatchSupabaseEnrichmentService {
  constructor(
    private readonly watchMediaCardCacheService = new WatchMediaCardCacheService(),
  ) {}

  async enrichContinueWatchingItems(
    client: DbClient,
    items: ContinueWatchingProductItem[],
  ): Promise<ContinueWatchingProductItem[]> {
    const records = await this.loadRecords(client, items.map((item) => item.media.mediaKey));
    return items.map((item) => {
      const record = records.get(item.media.mediaKey);
      return record ? { ...item, media: toLandscapeCard(item.media, record) } : item;
    });
  }

  async enrichRegularMediaItems<TItem extends RegularMediaItem>(client: DbClient, items: TItem[]): Promise<TItem[]> {
    const records = await this.loadRecords(client, items.map((item) => item.media.mediaKey));
    return items.map((item) => {
      const record = records.get(item.media.mediaKey);
      return record ? { ...item, media: toRegularCard(record) } : item;
    });
  }

  private async loadRecords(client: DbClient, mediaKeys: string[]): Promise<Map<string, WatchMediaCardCacheRecord>> {
    const uniqueMediaKeys = [...new Set(mediaKeys.filter((mediaKey) => mediaKey.trim()))];
    if (!uniqueMediaKeys.length) {
      return new Map();
    }

    const records = await this.watchMediaCardCacheService.listCardCacheRecords(client, uniqueMediaKeys);
    const missingCount = uniqueMediaKeys.length - records.size;
    if (missingCount > 0) {
      logger.debug({ requestedCount: uniqueMediaKeys.length, hitCount: records.size, missingCount }, 'watch supabase metadata cache misses');
    }
    return records;
  }
}

function toRegularCard(record: WatchMediaCardCacheRecord): RegularCardView {
  return {
    mediaType: record.titleMediaType,
    mediaKey: record.mediaKey,
    title: record.title,
    posterUrl: record.posterUrl,
    releaseYear: record.releaseYear,
    rating: record.rating,
    genre: null,
    subtitle: record.subtitle,
  };
}

function toLandscapeCard(
  fallback: ContinueWatchingProductItem['media'],
  record: WatchMediaCardCacheRecord,
): ContinueWatchingProductItem['media'] {
  return {
    ...fallback,
    mediaType: record.titleMediaType,
    mediaKey: record.mediaKey,
    title: record.title,
    posterUrl: record.posterUrl,
    backdropUrl: record.backdropUrl ?? fallback.backdropUrl,
    releaseYear: record.releaseYear,
    rating: record.rating,
    genre: null,
  };
}
