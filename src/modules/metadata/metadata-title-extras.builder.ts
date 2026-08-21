import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { assertPresent } from '../../lib/errors.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService, episodeRefMapKey } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { buildSeasonBaseItemDto, buildEpisodeBaseItemDto, buildDetailBaseItemDto } from './metadata-detail.builders.js';
import type { MetadataTitleExtras } from './metadata-detail.types.js';
import type { BaseItemDto, BaseItemDtoQueryResult } from './media-item.types.js';
import {
  extractCollection,
  extractCollectionParts,
  extractReviewsFromRaw,
  extractSimilarFromRaw,
} from './metadata-builder.shared.js';
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

    const episodes = await this.buildExtrasSection('episodes', resolvedTitle, effectiveLanguage, () => this.buildAllEpisodes(client, resolvedTitle), []);
    const seasons = await this.buildExtrasSection('seasons', resolvedTitle, effectiveLanguage, () => this.buildAllSeasons(client, resolvedTitle), []);
    const extrasRaw = await this.buildExtrasSection(
      'tmdbExtras',
      resolvedTitle,
      effectiveLanguage,
      () => this.tmdbCacheService.fetchTitleExtrasPayload(client, resolvedTitle.mediaType, resolvedTitle.tmdbId, effectiveLanguage),
      null,
    );
    const tmdbReviews = extrasRaw ? extractReviewsFromRaw(extrasRaw) : [];
    const reviews = await this.reviewAggregator.mergeTitleReviews(resolvedTitle, identity.mediaType, tmdbReviews, effectiveLanguage);
    const similar = await this.buildExtrasSection('similar', resolvedTitle, effectiveLanguage, () => this.buildSimilar(client, resolvedTitle, extrasRaw), []);
    const collection = await this.buildExtrasSection('collection', resolvedTitle, effectiveLanguage, () => this.buildFullCollection(client, resolvedTitle, effectiveLanguage), null);

    logger.info({
      tmdbId: resolvedTitle.tmdbId,
      mediaType: resolvedTitle.mediaType,
      language: effectiveLanguage,
      seasons: seasons.length,
      episodes: episodes.length,
      reviews: reviews.length,
      similar: similar.length,
      collectionItems: collection?.Items.length ?? 0,
    }, 'metadata title extras built');

    return { Seasons: seasons, Episodes: episodes, Reviews: reviews, Similar: similar, Collection: collection };
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

  private async buildAllEpisodes(client: DbClient, title: TmdbTitleRecord): Promise<BaseItemDto[]> {
    if (title.mediaType !== 'tv') {
      return [];
    }

    const seasonNumbers = extractSeasonNumbersFromTitle(title);
    await Promise.all(seasonNumbers.map(
      (seasonNumber) => this.tmdbCacheService.ensureSeasonCached(client, title.tmdbId, seasonNumber),
    ));

    const episodes = await this.tmdbCacheService.listEpisodesForShow(client, title.tmdbId);
    const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
      client,
      episodes.map((episode) => ({
        parentMediaType: 'show' as const,
        provider: 'tmdb' as const,
        parentProviderId: String(title.tmdbId),
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
      })),
    );

    const episodeItems = await Promise.all(episodes.map(async (episode) => {
      const contentId = episodeIds.get(episodeRefMapKey(
        String(title.tmdbId),
        episode.seasonNumber,
        episode.episodeNumber,
        null,
      ));
      if (!contentId) {
        return null;
      }
      const itemId = encodePublicItemId(contentId);
      const parentIds = await this.contentIdentityService.resolveParentItemIdsForEpisode(client, itemId);
      return parentIds.seriesItemId ? buildEpisodeBaseItemDto(title, episode, itemId, parentIds.seriesItemId, parentIds.seasonItemId) : null;
    }));

    return episodeItems.filter((item): item is BaseItemDto => item !== null);
  }

  private async buildSimilar(
    client: DbClient,
    title: TmdbTitleRecord,
    extrasRaw: Record<string, unknown> | null,
    language?: string | null,
  ): Promise<BaseItemDto[]> {
    const similarTitles = extractSimilarFromRaw(extrasRaw, title.mediaType);
    if (similarTitles.length === 0) {
      return [];
    }

    const similarIdentities = similarTitles
      .filter((t) => t.mediaType === 'movie' || t.mediaType === 'tv')
      .map((t) => inferMediaIdentity({
        mediaType: t.mediaType === 'movie' ? 'movie' : 'show',
        tmdbId: t.tmdbId,
      }));
    const similarContentIds = await this.contentIdentityService.ensureContentIds(client, similarIdentities);

    const related = await Promise.all(
      similarTitles.map((t) => this.buildRelatedItem(client, t, similarContentIds, language)),
    );
    return related.filter((item): item is NonNullable<typeof item> => item !== null);
  }

  private async buildFullCollection(client: DbClient, title: TmdbTitleRecord, language?: string | null): Promise<BaseItemDtoQueryResult | null> {
    const collection = extractCollection(title);
    if (!collection || typeof collection.id !== 'number') {
      return null;
    }

    const collectionRaw = await this.tmdbCacheService.getCollection(client, collection.id, language).catch(() => null);
    if (!collectionRaw) {
      return null;
    }

    const collectionParts = extractCollectionParts(collectionRaw);
    const collectionIdentities = collectionParts.map((t) => inferMediaIdentity({ mediaType: 'movie', tmdbId: t.tmdbId }));
    const collectionContentIds = await this.contentIdentityService.ensureContentIds(client, collectionIdentities);

    const parts = await Promise.all(
      collectionParts.map((t) => this.buildRelatedItem(client, t, collectionContentIds, language)),
    );

    const validParts = parts.filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      Items: validParts,
      StartIndex: 0,
      TotalRecordCount: validParts.length,
      NextCursor: null,
      HasMore: false,
    };
  }

  private async buildRelatedItem(
    client: DbClient,
    titleRecord: TmdbTitleRecord,
    contentIds: Map<string, string>,
    language?: string | null,
  ): Promise<BaseItemDto | null> {
    const mediaType = titleRecord.mediaType === 'movie' ? 'movie' : 'show';
    const identity = inferMediaIdentity({ mediaType, tmdbId: titleRecord.tmdbId });
    const contentId = contentIds.get(identity.mediaKey);
    if (!contentId) {
      return null;
    }

    const hydrated = await this.tmdbCacheService.getTitle(client, titleRecord.mediaType, titleRecord.tmdbId, language);
    if (!hydrated) {
      return null;
    }

    return buildDetailBaseItemDto({ identity, itemId: encodePublicItemId(contentId), title: hydrated, language });
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
