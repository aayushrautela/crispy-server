import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { assertPresent } from '../../lib/errors.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { buildSeasonBaseItemDto, buildDetailBaseItemDto } from './metadata-detail.builders.js';
import type { MetadataTitleExtras } from './metadata-detail.types.js';
import type { BaseItemDto, BaseItemDtoQueryResult } from './media-item.types.js';
import { extractCollection } from './metadata-builder.shared.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';
import { MetadataReviewAggregator } from './metadata-review-aggregator.js';

export class MetadataTitleExtrasBuilder {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly reviewAggregator = new MetadataReviewAggregator(),
  ) {}

  async buildTitleExtras(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleExtras> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
      throw new Error('Title extras require a title identity.');
    }

    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const resolvedTitle = assertPresent(source.tmdbTitle, 'Metadata title not found.');
    const effectiveLanguage = language ?? null;

    const seasons = await this.buildExtrasSection('seasons', resolvedTitle, effectiveLanguage, () => this.buildAllSeasons(client, resolvedTitle), []);
    const reviews = await this.buildExtrasSection('reviews', resolvedTitle, effectiveLanguage, () =>
      this.reviewAggregator.mergeTitleReviews(client, resolvedTitle, identity.mediaType as 'movie' | 'show', effectiveLanguage), []);
    const similar = await this.buildExtrasSection('similar', resolvedTitle, effectiveLanguage, () => this.buildRelated(client, resolvedTitle, 'recommendation', effectiveLanguage), []);
    const collection = await this.buildExtrasSection('collection', resolvedTitle, effectiveLanguage, () => this.buildFullCollection(client, resolvedTitle, effectiveLanguage), null);

    logger.info({
      tmdbId: resolvedTitle.tmdbId,
      mediaType: resolvedTitle.mediaType,
      language: effectiveLanguage,
      seasons: seasons.length,
      reviews: reviews.length,
      similar: similar.length,
      collectionItems: collection?.Items.length ?? 0,
    }, 'metadata title extras built');

    return { Seasons: seasons, Reviews: reviews, Similar: similar, Collection: collection };
  }

  private async buildExtrasSection<T>(
    section: string,
    title: TmdbTitleRecord,
    language: string | null,
    build: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await build();
    } catch (error) {
      logger.warn({
        err: error,
        section,
        tmdbId: title.tmdbId,
        mediaType: title.mediaType,
        language,
      }, 'metadata title extras section failed');
      return fallback;
    }
  }

  private async buildAllSeasons(client: DbClient, title: TmdbTitleRecord): Promise<BaseItemDto[]> {
    if (title.mediaType !== 'tv') {
      return [];
    }

    const seasonNumbers = extractSeasonNumbersFromTitle(title);
    if (seasonNumbers.length === 0) {
      return [];
    }

    const seasonIds = await this.contentIdentityService.ensureSeasonContentIds(client, {
      parentMediaType: 'show',
      provider: 'tmdb',
      parentProviderId: String(title.tmdbId),
    }, seasonNumbers);
    const seriesContentId = await this.contentIdentityService.ensureTitleContentId(client, {
      mediaType: 'show',
      provider: 'tmdb',
      providerId: String(title.tmdbId),
    });
    const seriesItemId = encodePublicItemId(seriesContentId);

    return seasonNumbers
      .map((seasonNumber) => {
        const seasonId = seasonIds.get(seasonNumber);
        return seasonId ? buildSeasonBaseItemDto(title, seasonNumber, encodePublicItemId(seasonId), seriesItemId) : null;
      })
      .filter((item): item is BaseItemDto => item !== null);
  }

  private async buildRelated(client: DbClient, title: TmdbTitleRecord, relationKind: 'recommendation' | 'collection_part', language?: string | null): Promise<BaseItemDto[]> {
    const relatedTitles = await this.tmdbCacheService.getRelatedTitles(client, title.mediaType, title.tmdbId, relationKind, language);
    return this.buildRelatedItems(client, relatedTitles, language);
  }

  private async buildFullCollection(client: DbClient, title: TmdbTitleRecord, language?: string | null): Promise<BaseItemDtoQueryResult | null> {
    const collection = extractCollection(title);
    if (!collection || typeof collection.id !== 'number') {
      return null;
    }

    await this.tmdbCacheService.ensureCollectionCached(client, collection.id, language).catch(() => false);
    const parts = await this.tmdbCacheService.getRelatedTitles(client, 'collection', collection.id, 'collection_part', language);
    if (parts.length === 0) {
      return null;
    }

    const items = await this.buildRelatedItems(client, parts, language);
    return {
      Items: items,
      StartIndex: 0,
      TotalRecordCount: items.length,
      NextCursor: null,
      HasMore: false,
    };
  }

  /** Related titles arrive hydrated from the relations join; only canonical ids are resolved here. */
  private async buildRelatedItems(client: DbClient, titles: TmdbTitleRecord[], language?: string | null): Promise<BaseItemDto[]> {
    const identities = titles
      .filter((t) => t.mediaType === 'movie' || t.mediaType === 'tv')
      .map((t) => inferMediaIdentity({ mediaType: t.mediaType === 'movie' ? 'movie' : 'show', tmdbId: t.tmdbId }));
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

    const items: BaseItemDto[] = [];
    for (const titleRecord of titles) {
      const mediaType = titleRecord.mediaType === 'movie' ? 'movie' : 'show';
      const identity = inferMediaIdentity({ mediaType, tmdbId: titleRecord.tmdbId });
      const contentId = contentIds.get(identity.mediaKey);
      if (!contentId) {
        continue;
      }
      items.push(buildDetailBaseItemDto({ identity, itemId: encodePublicItemId(contentId), title: titleRecord, language: language ?? null }));
    }
    return items;
  }
}

function extractSeasonNumbersFromTitle(title: TmdbTitleRecord): number[] {
  const rawSeasons = Array.isArray(title.raw.seasons) ? title.raw.seasons : [];
  return rawSeasons
    .filter((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return false;
      }
      const episodeCount = (entry as Record<string, unknown>).episode_count;
      return episodeCount !== 0;
    })
    .map((entry) => Number((entry as Record<string, unknown>).season_number))
    .filter((seasonNumber) => Number.isInteger(seasonNumber) && seasonNumber >= 0)
    .sort((left, right) => left - right);
}
