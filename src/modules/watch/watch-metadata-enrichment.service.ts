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
    Primary: record.posterUrl
      ? buildResponsiveImageSet(record.posterUrl, { small: 'w342', medium: 'w500', large: 'w780' })
      : null,
    Backdrop: record.backdropUrl
      ? [buildResponsiveImageSet(record.backdropUrl, { small: 'w300', medium: 'w780', large: 'w1280' })]
      : [],
    Logo: record.logoUrl
      ? buildResponsiveImageSet(record.logoUrl, { small: 'w185', medium: 'w300', large: 'w500' })
      : null,
    Thumb: record.stillUrl
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
    const mediaKeys = items.map((item) => item.mediaItem.Id);
    const parentKeys = items
      .filter((item) => item.mediaItem.Type === 'Episode')
      .map((item) => item.id)
      .filter((k): k is string => !!k);
    const allKeys = [...new Set([...mediaKeys, ...parentKeys])];
    const records = await this.loadRecords(client, allKeys, language);

    return items.reduce<ContinueWatchingProductItem[]>((acc, item) => {
      const record = records.get(item.mediaItem.Id);
      if (!record) {
        return acc;
      }

      const parentKey = item.mediaItem.Type === 'Episode' ? item.id : null;
      const parentRecord = parentKey ? records.get(parentKey) : undefined;

      if (item.mediaItem.Type === 'Episode' && !parentRecord) {
        return acc;
      }

      const enriched = mergeEnrichedMediaItemDto(record, item.mediaItem);

      if (parentRecord) {
        enriched.SeriesName = enriched.SeriesName ?? parentRecord.title;
        enriched.ParentImageTags = enriched.ParentImageTags ?? buildParentImageTags(parentRecord);
      }

      return acc.concat([{ ...item, mediaItem: enriched }]);
    }, []);
  }

  async enrichRegularMediaItems<TItem extends RegularMediaItem>(client: DbClient, items: TItem[], language?: string | null): Promise<TItem[]> {
    const records = await this.loadRecords(client, items.map((item) => item.mediaItem.Id), language);
    return items.map((item) => {
      const record = records.get(item.mediaItem.Id);
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
    Id: existing.Id,
    Name: enriched.Name || existing.Name,
    OriginalTitle: existing.OriginalTitle,
    Overview: enriched.Overview ?? existing.Overview,
    ImageTags: {
      ...enriched.ImageTags,
      Thumb: existing.ImageTags.Thumb ?? enriched.ImageTags.Thumb,
    },
    CommunityRating: enriched.CommunityRating ?? existing.CommunityRating,
    Genres: enriched.Genres,
    RunTimeTicks: enriched.RunTimeTicks ?? existing.RunTimeTicks,
    Status: enriched.Status ?? existing.Status,
    OfficialRating: enriched.OfficialRating ?? existing.OfficialRating,
    Certification: enriched.Certification ?? existing.Certification,
    RemoteTrailers: enriched.RemoteTrailers,
    PosterColor: enriched.PosterColor,
    BackdropColor: enriched.BackdropColor,
    ProviderIds: existing.ProviderIds,
    SeriesId: existing.SeriesId,
    SeriesName: existing.SeriesName || enriched.SeriesName || null,
    SeasonId: existing.SeasonId,
    SeasonName: existing.SeasonName,
    ParentIndexNumber: existing.ParentIndexNumber,
    IndexNumber: existing.IndexNumber,
    AbsoluteIndexNumber: existing.AbsoluteIndexNumber,
    EpisodeTitle: existing.EpisodeTitle ?? enriched.EpisodeTitle ?? null,
    AirDate: existing.AirDate ?? enriched.AirDate ?? null,
    ParentImageTags: existing.ParentImageTags ?? enriched.ParentImageTags,
    UserData: existing.UserData,
  };
}
