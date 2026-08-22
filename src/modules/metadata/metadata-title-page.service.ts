import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ContentIdentityService, episodeRefMapKey } from '../identity/content-identity.service.js';
import { assertPublicItemId, encodePublicItemId } from '../identity/public-item-id.js';
import type { MetadataTitleDetail } from './metadata-detail.types.js';
import type { BaseItemDto, BaseItemDtoQueryResult } from './media-item.types.js';
import { resolveMetadataItemIdentity, resolveSeriesItemIdentity } from './metadata-route-identity.js';
import { MetadataTitleAggregateBuilder } from './metadata-title-aggregate.builder.js';
import { buildEpisodeBaseItemDto } from './metadata-detail.builders.js';
import { MetadataTitleCacheService } from './metadata-title-cache.service.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { TmdbEpisodeRecord, TmdbTitleRecord } from './providers/tmdb.types.js';
import { metadataTitlePageCacheKey } from './metadata-title-cache-keys.js';

export class MetadataTitlePageService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly aggregateBuilder = new MetadataTitleAggregateBuilder(),
    private readonly cacheService = new MetadataTitleCacheService(),
    private readonly detailCoreService = new MetadataDetailCoreService(),
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async getTitlePage(itemId: string, language?: string | null): Promise<MetadataTitleDetail> {
    const publicItemId = itemId.trim();
    assertPublicItemId(publicItemId);
    const cacheKey = metadataTitlePageCacheKey(publicItemId, language ?? null);
    return this.cacheService.getOrSet(cacheKey, publicItemId, async () => withDbClient(async (client) => {
      const identity = await resolveMetadataItemIdentity(client, this.contentIdentityService, publicItemId);
      if (identity.mediaType === 'movie' || identity.mediaType === 'show') {
        return this.aggregateBuilder.buildTitleDetail(client, identity, language ?? null);
      }
      const seriesIdentity = await resolveSeriesItemIdentity(client, this.contentIdentityService, publicItemId);
      const seriesDetail = await this.aggregateBuilder.buildTitleDetail(client, seriesIdentity, language ?? null);
      const itemDetail = await this.detailCoreService.buildMetadataView(client, identity, language ?? null);
      return { ...seriesDetail, Item: itemDetail };
    }));
  }

  async getSeriesEpisodes(
    seriesItemId: string,
    language?: string | null,
    season?: number | null,
  ): Promise<BaseItemDtoQueryResult> {
    const publicItemId = seriesItemId.trim();
    assertPublicItemId(publicItemId);
    return withDbClient(async (client) => {
      const seriesIdentity = await resolveSeriesItemIdentity(client, this.contentIdentityService, publicItemId);
      const source = await this.titleSourceService.loadTitleSource(client, seriesIdentity, language ?? null);
      const title = source.tmdbTitle;
      if (!title) {
        return emptyEpisodeResult();
      }

      const seasonNumbers = season !== null && season !== undefined ? [season] : extractSeasonNumbers(title);
      const parentProviderId = String(title.tmdbId);
      const episodeRecords: TmdbEpisodeRecord[] = [];
      for (const seasonNumber of seasonNumbers) {
        const episodes = await this.tmdbCacheService.getSeasonEpisodes(client, title.tmdbId, seasonNumber);
        for (const episode of episodes) {
          episodeRecords.push(episode);
        }
      }

      if (episodeRecords.length === 0) {
        return emptyEpisodeResult();
      }

      const episodeContentIds = await this.contentIdentityService.ensureEpisodeContentIds(client, episodeRecords.map((episode) => ({
        parentMediaType: 'show',
        provider: 'tmdb',
        parentProviderId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
      })));

      const episodeViews = episodeRecords.map((episode) => {
        const contentId = episodeContentIds.get(episodeRefMapKey(parentProviderId, episode.seasonNumber, episode.episodeNumber));
        if (!contentId) {
          throw new HttpError(500, 'Unable to resolve canonical episode id.');
        }
        return { episode, episodeItemId: encodePublicItemId(contentId) };
      });

      const parentMap = await this.contentIdentityService.resolveParentItemIdsForEpisodes(client, episodeViews.map((view) => view.episodeItemId));
      const seriesContentId = seriesIdentity.contentId;
      if (!seriesContentId) {
        throw new HttpError(500, 'Unable to resolve series content id.');
      }
      const seriesItemPublicId = encodePublicItemId(seriesContentId);

      const items: BaseItemDto[] = episodeViews.map(({ episode, episodeItemId }) => {
        const parents = parentMap.get(episodeItemId);
        return buildEpisodeBaseItemDto(title, episode, episodeItemId, seriesItemPublicId, parents?.seasonItemId ?? null);
      });

      return {
        Items: items,
        StartIndex: 0,
        TotalRecordCount: items.length,
        NextCursor: null,
        HasMore: false,
      };
    });
  }
}

function emptyEpisodeResult(): BaseItemDtoQueryResult {
  return {
    Items: [],
    StartIndex: 0,
    TotalRecordCount: 0,
    NextCursor: null,
    HasMore: false,
  };
}

function extractSeasonNumbers(title: TmdbTitleRecord): number[] {
  const seasons = title.raw?.seasons;
  const numbers: number[] = [];
  if (Array.isArray(seasons)) {
    for (const season of seasons) {
      if (season && typeof season === 'object' && typeof (season as Record<string, unknown>).season_number === 'number') {
        numbers.push((season as Record<string, unknown>).season_number as number);
      }
    }
  }
  if (numbers.length === 0 && title.numberOfSeasons && title.numberOfSeasons > 0) {
    for (let seasonNumber = 1; seasonNumber <= title.numberOfSeasons; seasonNumber += 1) {
      numbers.push(seasonNumber);
    }
  }
  return numbers;
}
