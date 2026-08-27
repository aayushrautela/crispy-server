import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { assertPresent } from '../../lib/errors.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { buildMetadataCardView } from './metadata-card.builders.js';
import { toClientMediaCard } from './client-media-card.mapper.js';
import type { ClientMediaCard, ClientMediaCardQueryResult } from '../recommendations/client-home.types.js';
import type { MetadataTitleExtras } from './metadata-detail.types.js';
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
    // Backward compat: hydrates at builder (Phase 4 moves similar/collection to route)
    const internal = await this.buildTitleExtrasInternal(client, identity, language);
    // Hydrate similar/collection at builder for backward compat — route will do it after hard cutoff
    const { MetadataCardService } = await import('./metadata-card.service.js');
    const metadataCardService = new MetadataCardService();
    const similarViews = internal.similar.length
      ? await metadataCardService.buildCardViews(client, internal.similar, language ?? null)
      : [];
    const similar: ClientMediaCard[] = [];
    for (const view of similarViews) {
      if (!view || !view.title) continue;
      const { toClientMediaCard } = await import('./client-media-card.mapper.js');
      similar.push(toClientMediaCard(view, { progress: null }));
    }
    let collection: ClientMediaCardQueryResult | null = null;
    if (internal.collection && internal.collection.length) {
      const collectionViews = await metadataCardService.buildCardViews(client, internal.collection, language ?? null);
      const collectionCards: ClientMediaCard[] = [];
      for (const view of collectionViews) {
        if (!view || !view.title) continue;
        const { toClientMediaCard } = await import('./client-media-card.mapper.js');
        collectionCards.push(toClientMediaCard(view, { progress: null }));
      }
      collection = collectionCards.length
        ? { Items: collectionCards, StartIndex: 0, TotalRecordCount: collectionCards.length, NextCursor: null, HasMore: false }
        : null;
    }
    // Seasons still hydrated inside builder (keep as is for now)
    const seasons = await this.buildAllSeasons(client, internal.resolvedTitle, language ?? null);
    return { Seasons: seasons, Reviews: internal.reviews, Similar: similar, Collection: collection };
  }

  async buildTitleExtrasInternal(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<{
    resolvedTitle: TmdbTitleRecord;
    seasons: ClientMediaCard[];
    similar: MediaIdentity[];
    collection: MediaIdentity[] | null;
    reviews: import('./metadata-detail.types.js').MetadataReviewView[];
    effectiveLanguage: string | null;
  }> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
      throw new Error('Title extras require a title identity.');
    }
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const resolvedTitle = assertPresent(source.tmdbTitle, 'Metadata title not found.');
    const effectiveLanguage = language ?? null;
    const reviews = await this.buildExtrasSection('reviews', resolvedTitle, effectiveLanguage, () =>
      this.reviewAggregator.mergeTitleReviews(client, resolvedTitle, identity.mediaType as 'movie' | 'show', effectiveLanguage), []);
    const similar = await this.buildExtrasSection('similar', resolvedTitle, effectiveLanguage, () => this.buildRelatedIdentities(client, resolvedTitle, 'recommendation', effectiveLanguage), []);
    const collection = await this.buildExtrasSection('collection', resolvedTitle, effectiveLanguage, () => this.buildFullCollectionIdentities(client, resolvedTitle, effectiveLanguage), null);
    // Seasons keep builder hydration for now (needs seriesItemId custom logic); will move in next iteration
    const seasons = await this.buildExtrasSection('seasons', resolvedTitle, effectiveLanguage, () => this.buildAllSeasons(client, resolvedTitle, effectiveLanguage), []);
    logger.info({
      tmdbId: resolvedTitle.tmdbId,
      mediaType: resolvedTitle.mediaType,
      language: effectiveLanguage,
      seasons: seasons.length,
      reviews: reviews.length,
      similar: similar.length,
      collectionItems: collection?.length ?? 0,
    }, 'metadata title extras built (internal)');
    return { resolvedTitle, seasons, similar, collection, reviews, effectiveLanguage };
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

  private async buildAllSeasons(client: DbClient, title: TmdbTitleRecord, language: string | null): Promise<ClientMediaCard[]> {
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

    const showIdentity = inferMediaIdentity({ mediaType: 'show', provider: 'tmdb', providerId: String(title.tmdbId) });
    const seasonIdentities = seasonNumbers
      .map((seasonNumber) => {
        const seasonId = seasonIds.get(seasonNumber);
        return seasonId
          ? inferMediaIdentity({ mediaType: 'season', provider: 'tmdb', showTmdbId: title.tmdbId, seasonNumber })
          : null;
      })
      .filter((identity): identity is MediaIdentity => identity !== null);

    const views = await this.titleSourceService.loadTitleSources(client, [showIdentity, ...seasonIdentities], language);
    const showView = views.get(showIdentity.mediaKey) ?? null;
    const showTitle = showView?.tmdbTitle?.name ?? showView?.tmdbTitle?.originalName ?? null;

    const cards: ClientMediaCard[] = [];
    for (const seasonNumber of seasonNumbers) {
      const seasonId = seasonIds.get(seasonNumber);
      if (!seasonId) continue;
      const identity = inferMediaIdentity({ mediaType: 'season', provider: 'tmdb', showTmdbId: title.tmdbId, seasonNumber });
      const view = views.get(identity.mediaKey);
      if (!view) continue;
      const card = buildMetadataCardView({
        identity,
        itemId: encodePublicItemId(seasonId),
        seriesItemId,
        title: view.tmdbTitle,
        currentSeason: view.tmdbCurrentSeason,
        language,
      });
      cards.push(toClientMediaCard(card, { progress: null, itemId: encodePublicItemId(seasonId), seriesTitle: showTitle ?? undefined }));
    }
    return cards;
  }

  private async buildAllSeasonsIdentities(client: DbClient, title: TmdbTitleRecord, _language: string | null): Promise<MediaIdentity[]> {
    if (title.mediaType !== 'tv') return [];
    const seasonNumbers = extractSeasonNumbersFromTitle(title);
    if (seasonNumbers.length === 0) return [];
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

  private async buildRelated(client: DbClient, title: TmdbTitleRecord, relationKind: 'recommendation' | 'collection_part', language?: string | null): Promise<ClientMediaCard[]> {
    const relatedTitles = await this.tmdbCacheService.getRelatedTitles(client, title.mediaType, title.tmdbId, relationKind, language);
    return this.buildRelatedItems(client, relatedTitles, language);
  }

  private async buildRelatedIdentities(client: DbClient, title: TmdbTitleRecord, relationKind: 'recommendation' | 'collection_part', language?: string | null): Promise<MediaIdentity[]> {
    const relatedTitles = await this.tmdbCacheService.getRelatedTitles(client, title.mediaType, title.tmdbId, relationKind, language);
    return relatedTitles
      .filter((t) => t.mediaType === 'movie' || t.mediaType === 'tv')
      .map((t) => inferMediaIdentity({ mediaType: t.mediaType === 'movie' ? 'movie' : 'show', tmdbId: t.tmdbId }));
  }

  private async buildFullCollectionIdentities(client: DbClient, title: TmdbTitleRecord, language?: string | null): Promise<MediaIdentity[] | null> {
    const collection = extractCollection(title);
    if (!collection || typeof collection.id !== 'number') return null;
    await this.tmdbCacheService.ensureCollectionCached(client, collection.id, language).catch(() => false);
    const parts = await this.tmdbCacheService.getRelatedTitles(client, 'collection', collection.id, 'collection_part', language);
    if (parts.length === 0) return null;
    return parts
      .filter((t) => t.mediaType === 'movie' || t.mediaType === 'tv')
      .map((t) => inferMediaIdentity({ mediaType: t.mediaType === 'movie' ? 'movie' : 'show', tmdbId: t.tmdbId }));
  }

  private async buildFullCollection(client: DbClient, title: TmdbTitleRecord, language?: string | null): Promise<ClientMediaCardQueryResult | null> {
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
  private async buildRelatedItems(client: DbClient, titles: TmdbTitleRecord[], language?: string | null): Promise<ClientMediaCard[]> {
    const identities = titles
      .filter((t) => t.mediaType === 'movie' || t.mediaType === 'tv')
      .map((t) => inferMediaIdentity({ mediaType: t.mediaType === 'movie' ? 'movie' : 'show', tmdbId: t.tmdbId }));
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

    const cards: ClientMediaCard[] = [];
    for (const titleRecord of titles) {
      const mediaType = titleRecord.mediaType === 'movie' ? 'movie' : 'show';
      const identity = inferMediaIdentity({ mediaType, tmdbId: titleRecord.tmdbId });
      const contentId = contentIds.get(identity.mediaKey);
      if (!contentId) {
        continue;
      }
      const view = buildMetadataCardView({ identity, itemId: encodePublicItemId(contentId), title: titleRecord, language: language ?? null });
      cards.push(toClientMediaCard(view, { progress: null }));
    }
    return cards;
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
