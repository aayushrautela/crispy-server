import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { assertPresent } from '../../lib/errors.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import type { MetadataTitleExtrasInternal } from './metadata-detail.types.js';
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

  /**
   * Brain 1 only: resolves the title, its season identities, related-title
   * identities (similar/collection) and reviews. The route boundary turns the
   * identities into `ClientMediaCard` via `MetadataCardService.buildCardViews`.
   */
  async buildTitleExtrasInternal(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleExtrasInternal> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
      throw new Error('Title extras require a title identity.');
    }
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const resolvedTitle = assertPresent(source.tmdbTitle, 'Metadata title not found.');
    const effectiveLanguage = language ?? null;

    const reviews = await this.buildExtrasSection('reviews', resolvedTitle, effectiveLanguage, () =>
      this.reviewAggregator.mergeTitleReviews(client, resolvedTitle, identity.mediaType as 'movie' | 'show', effectiveLanguage), []);
    const similar = await this.buildExtrasSection('similar', resolvedTitle, effectiveLanguage, () => this.buildRelatedIdentities(client, resolvedTitle, 'recommendation', effectiveLanguage), []);
    const collectionData = await this.buildExtrasSection('collection', resolvedTitle, effectiveLanguage, () => this.buildFullCollectionIdentities(client, resolvedTitle, effectiveLanguage), null);

    const seasonIdentities = resolvedTitle.mediaType === 'tv'
      ? await this.buildExtrasSection('seasons', resolvedTitle, effectiveLanguage, () => this.buildSeasonIdentities(client, resolvedTitle, effectiveLanguage), [])
      : [];
    const seriesItemId = resolvedTitle.mediaType === 'tv'
      ? encodePublicItemId(await this.contentIdentityService.ensureTitleContentId(client, {
        mediaType: 'show',
        provider: 'tmdb',
        providerId: String(resolvedTitle.tmdbId),
      }))
      : '';
    const seriesTitle = resolvedTitle.name ?? resolvedTitle.originalName ?? null;

    logger.info({
      tmdbId: resolvedTitle.tmdbId,
      mediaType: resolvedTitle.mediaType,
      language: effectiveLanguage,
      seasons: seasonIdentities.length,
      reviews: reviews.length,
      similar: similar.length,
      collectionItems: collection?.length ?? 0,
    }, 'metadata title extras built (internal)');
    return { resolvedTitle, seasonIdentities, seriesItemId, seriesTitle, similar, collection: collectionData?.identities ?? null, collectionName: collectionData?.name ?? null, reviews, effectiveLanguage };
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

  private async buildSeasonIdentities(client: DbClient, title: TmdbTitleRecord, _language: string | null): Promise<MediaIdentity[]> {
    const seasonNumbers = extractSeasonNumbersFromTitle(title);
    if (seasonNumbers.length === 0) {
      return [];
    }
    const seasonIds = await this.contentIdentityService.ensureSeasonContentIds(client, {
      parentMediaType: 'show',
      provider: 'tmdb',
      parentProviderId: String(title.tmdbId),
    }, seasonNumbers);
    return seasonNumbers
      .map((seasonNumber) => {
        const seasonId = seasonIds.get(seasonNumber);
        return seasonId ? inferMediaIdentity({ mediaType: 'season', provider: 'tmdb', showTmdbId: title.tmdbId, seasonNumber }) : null;
      })
      .filter((identity): identity is MediaIdentity => identity !== null);
  }

  private async buildRelatedIdentities(client: DbClient, title: TmdbTitleRecord, relationKind: 'recommendation' | 'collection_part', language?: string | null): Promise<MediaIdentity[]> {
    const relatedTitles = await this.tmdbCacheService.getRelatedTitles(client, title.mediaType, title.tmdbId, relationKind, language);
    return relatedTitles
      .filter((t) => t.mediaType === 'movie' || t.mediaType === 'tv')
      .map((t) => inferMediaIdentity({ mediaType: t.mediaType === 'movie' ? 'movie' : 'show', tmdbId: t.tmdbId }));
  }

  private async buildFullCollectionIdentities(client: DbClient, title: TmdbTitleRecord, language?: string | null): Promise<{ identities: MediaIdentity[]; name: string | null } | null> {
    const collection = extractCollection(title);
    if (!collection || typeof collection.id !== 'number') return null;
    await this.tmdbCacheService.ensureCollectionCached(client, collection.id, language).catch(() => false);
    const parts = await this.tmdbCacheService.getRelatedTitles(client, 'collection', collection.id, 'collection_part', language);
    if (parts.length === 0) return null;
    const identities = parts
      .filter((t) => t.mediaType === 'movie' || t.mediaType === 'tv')
      .map((t) => inferMediaIdentity({ mediaType: t.mediaType === 'movie' ? 'movie' : 'show', tmdbId: t.tmdbId }));
    return { identities, name: collection.name ?? null };
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
