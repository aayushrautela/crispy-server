import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import type { BaseItemDto, ParentBaseItemImageTags } from '../metadata/media-item.types.js';
import { watchCacheRecordToBaseItemDto } from '../metadata/media-item.mapper.js';
import { buildResponsiveImageSet, emptyResponsiveImageSet } from '../metadata/metadata-builder.shared.js';
import type { WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';
import { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import { WatchCacheMissRefreshService } from './watch-cache-miss-refresh.service.js';

type RegularMediaItem = BaseItemDto;

type CacheMissRefreshDependency = Pick<WatchCacheMissRefreshService, 'refreshMissingCardsAndReturnRecords'>;

function buildParentImageTags(record: WatchMediaCardCacheRecord): ParentBaseItemImageTags {
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
    items: BaseItemDto[],
    language?: string | null,
  ): Promise<BaseItemDto[]> {
    const itemIds = items.map((item) => item.Id);
    const parentIds = items
      .filter((item) => item.Type === 'Episode')
      .map((item) => item.SeriesId)
      .filter((id): id is string => !!id);
    const allIds = [...new Set([...itemIds, ...parentIds])];
    const records = await this.loadRecords(client, allIds, language);

    return items.reduce<BaseItemDto[]>((acc, item) => {
      const record = records.get(item.Id);
      if (!record) {
        return acc;
      }

      const parentId = item.Type === 'Episode' ? item.SeriesId : null;
      const parentRecord = parentId ? records.get(parentId) : undefined;

      if (item.Type === 'Episode' && !parentRecord) {
        return acc;
      }

      const enriched = mergeEnrichedMediaItemDto(record, item);

      if (parentRecord) {
        enriched.SeriesName = enriched.SeriesName ?? parentRecord.title;
        enriched.ParentImageTags = enriched.ParentImageTags ?? buildParentImageTags(parentRecord);
      }

      return acc.concat([enriched]);
    }, []);
  }

  async enrichRegularMediaItems<TItem extends BaseItemDto>(client: DbClient, items: TItem[], language?: string | null): Promise<TItem[]> {
    const records = await this.loadRecords(client, items.map((item) => item.Id), language);
    return items.map((item) => {
      const record = records.get(item.Id);
      if (!record) {
        return item;
      }
      return mergeEnrichedMediaItemDto(record, item) as TItem;
    });
  }

  private async loadRecords(client: DbClient, itemIds: string[], language?: string | null): Promise<Map<string, WatchMediaCardCacheRecord>> {
    const uniqueItemIds = [...new Set(itemIds.filter((itemId) => itemId.trim()))];
    if (!uniqueItemIds.length) {
      return new Map();
    }

    const records = await this.watchMediaCardCacheService.listCardCacheRecords(client, uniqueItemIds, language);
    const missingCount = uniqueItemIds.length - records.size;
    if (missingCount > 0) {
      const missingIds = uniqueItemIds.filter((id) => !records.has(id));
      logger.debug({ requestedCount: uniqueItemIds.length, hitCount: records.size, missingCount }, 'watch metadata cache misses');
      const refreshedRecords = await this.cacheMissRefreshService.refreshMissingCardsAndReturnRecords(client, missingIds, language);
      for (const [key, record] of refreshedRecords.entries()) {
        records.set(key, record);
      }
    }
    return records;
  }
}

function mergeEnrichedMediaItemDto(record: WatchMediaCardCacheRecord, existing: BaseItemDto): BaseItemDto {
  const enriched = watchCacheRecordToBaseItemDto(record);
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
