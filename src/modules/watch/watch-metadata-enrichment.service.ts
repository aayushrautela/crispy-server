import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import type { MediaItemDto, ParentMediaImageTags } from '../metadata/media-item.types.js';
import { watchCacheRecordToMediaItemDto } from '../metadata/media-item.mapper.js';
import { buildResponsiveImageSet, emptyResponsiveImageSet } from '../metadata/metadata-builder.shared.js';
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

function buildParentImageTags(record: WatchMediaCardCacheRecord): ParentMediaImageTags {
  return {
    primary: record.posterUrl
      ? buildResponsiveImageSet(record.posterUrl, { small: 'w342', medium: 'w500', large: 'w780' })
      : null,
    backdrop: record.backdropUrl
      ? [buildResponsiveImageSet(record.backdropUrl, { small: 'w300', medium: 'w780', large: 'w1280' })]
      : [],
    logo: record.logoUrl
      ? buildResponsiveImageSet(record.logoUrl, { small: 'w185', medium: 'w300', large: 'w500' })
      : null,
    thumb: record.stillUrl
      ? buildResponsiveImageSet(record.stillUrl, { small: 'w185', medium: 'w300', large: 'original' })
      : null,
  };
}

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
      .filter((item) => item.mediaItem.type === 'Episode')
      .map((item) => item.id)
      .filter((k): k is string => !!k);
    const allKeys = [...new Set([...mediaKeys, ...parentKeys])];
    const records = await this.loadRecords(client, allKeys, language);

    return items.reduce<ContinueWatchingProductItem[]>((acc, item) => {
      const record = records.get(item.mediaItem.mediaKey);
      if (!record) {
        return acc;
      }

      const parentKey = item.mediaItem.type === 'Episode' ? item.id : null;
      const parentRecord = parentKey ? records.get(parentKey) : undefined;

      if (item.mediaItem.type === 'Episode' && !parentRecord) {
        return acc;
      }

      const enriched = mergeEnrichedMediaItemDto(record, item.mediaItem);

      if (parentRecord) {
        enriched.seriesName = enriched.seriesName ?? parentRecord.title;
        enriched.parentImageTags = enriched.parentImageTags ?? buildParentImageTags(parentRecord);
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
        mediaItem: mergeEnrichedMediaItemDto(record, item.mediaItem),
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

function mergeEnrichedMediaItemDto(record: WatchMediaCardCacheRecord, existing: MediaItemDto): MediaItemDto {
  const enriched = watchCacheRecordToMediaItemDto(record);
  const still = record.stillUrl
    ? { small: null, medium: null, large: null }
    : null;

  return {
    ...enriched,
    id: existing.id,
    name: enriched.name || existing.name,
    originalTitle: existing.originalTitle,
    overview: enriched.overview ?? existing.overview,
    imageTags: {
      ...enriched.imageTags,
      thumb: existing.imageTags.thumb ?? enriched.imageTags.thumb,
    },
    communityRating: enriched.communityRating ?? existing.communityRating,
    genres: enriched.genres,
    runTimeSeconds: enriched.runTimeSeconds ?? existing.runTimeSeconds,
    status: enriched.status ?? existing.status,
    officialRating: enriched.officialRating ?? existing.officialRating,
    certification: enriched.certification ?? existing.certification,
    trailerUrl: enriched.trailerUrl,
    trailerThumbnailUrl: enriched.trailerThumbnailUrl,
    posterColor: enriched.posterColor,
    backdropColor: enriched.backdropColor,
    providerIds: existing.providerIds,
    seriesId: existing.seriesId,
    seriesName: existing.seriesName || enriched.seriesName || null,
    seasonId: existing.seasonId,
    seasonName: existing.seasonName,
    parentIndexNumber: existing.parentIndexNumber,
    indexNumber: existing.indexNumber,
    absoluteIndexNumber: existing.absoluteIndexNumber,
    episodeTitle: existing.episodeTitle ?? enriched.episodeTitle ?? null,
    airDate: existing.airDate ?? enriched.airDate ?? null,
    parentImageTags: existing.parentImageTags ?? enriched.parentImageTags,
    userData: existing.userData,
  };
}
