import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { assertPresent } from '../../lib/errors.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import type { MetadataExtrasListInternal, MetadataExtrasListKey, MetadataTitleExtrasInternal } from './metadata-detail.types.js';
import { extractCollection, tmdbGenreName } from './metadata-builder.shared.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';
import { MetadataReviewAggregator } from './metadata-review-aggregator.js';

type ExtrasListBuildResult = { identities: MediaIdentity[]; title: string | null };

const LIST_DEFAULT_TITLES: Record<MetadataExtrasListKey, string> = {
  MoreLikeThis: 'More Like This',
  MoreByGenre: 'More by Genre',
  Collection: 'Collection',
};

export class MetadataTitleExtrasBuilder {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly reviewAggregator = new MetadataReviewAggregator(),
  ) {}

  /**
   * Brain 1 only: resolves the title, its season identities, related-title
   * list identities (id-less, named shelves) and reviews. The route boundary
   * turns each list's identities into `ClientMediaCard` via
   * `MetadataCardService.buildCardViews`.
   *
   * Shelves are self-describing (key + title + identities). Adding a new shelf
   * is a builder-only change: register it in {@link listBuilders} — no contract
   * or route changes.
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
    const lists = await this.buildLists(client, resolvedTitle, effectiveLanguage);

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
      lists: lists.map(({ key, title, identities }) => ({ key, title, count: identities.length })),
    }, 'metadata title extras built (internal)');
    return {
      resolvedTitle,
      seasonIdentities,
      seriesItemId,
      seriesTitle,
      lists,
      reviews,
      effectiveLanguage,
    };
  }

  /**
   * Named shelves the extras response can carry, in display order. Each entry
   * is `key` (stable client identifier) + `title` (human label, fallback title
   * applied if a shelf has no specific one) + identity list. Fallbacks keep
   * every shelf present but empty on failure. A shelf is never emitted without
   * a title — the contract requires it.
   */
  private readonly listBuilders: { key: MetadataExtrasListKey; build: (...args: [client: DbClient, title: TmdbTitleRecord, language: string | null]) => Promise<ExtrasListBuildResult> }[] = [
    {
      key: 'MoreLikeThis',
      build: (client, title, language) => this.buildRelatedIdentities(client, title, 'recommendation', language).then((identities) => ({ identities, title: null })),
    },
    {
      key: 'MoreByGenre',
      build: (client, title, language) => this.buildMoreByGenre(client, title, language),
    },
    {
      key: 'Collection',
      build: (client, title, language) => this.buildCollection(client, title, language),
    },
  ];

  private async buildLists(client: DbClient, title: TmdbTitleRecord, language: string | null): Promise<MetadataExtrasListInternal[]> {
    const lists: MetadataExtrasListInternal[] = [];
    for (const builder of this.listBuilders) {
      const result = await this.buildExtrasSection(builder.key, title, language, () => builder.build(client, title, language), { identities: [], title: null });
      lists.push({ key: builder.key, title: result.title ?? LIST_DEFAULT_TITLES[builder.key], identities: result.identities });
    }
    return lists;
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

  private async buildMoreByGenre(client: DbClient, title: TmdbTitleRecord, language: string | null): Promise<ExtrasListBuildResult> {
    const genreIds = pickTopGenreIds(title, 2);
    if (genreIds.length < 2) {
      return { identities: [], title: null };
    }
    const genreNames = genreIds.map((id) => tmdbGenreName(id)).filter((name): name is string => name !== null);
    if (genreNames.length < 2) {
      return { identities: [], title: null };
    }
    const mediaType = title.mediaType === 'tv' ? 'tv' : 'movie';
    const related = await this.tmdbCacheService.discoverTitlesByGenres(client, {
      mediaType,
      genreIds,
      limit: 20,
      locale: language,
      excludeTmdbId: title.tmdbId,
    });
    const identities = related
      .filter((t) => t.mediaType === 'movie' || t.mediaType === 'tv')
      .map((t) => inferMediaIdentity({ mediaType: t.mediaType === 'movie' ? 'movie' : 'show', tmdbId: t.tmdbId }));
    if (!identities.length) {
      return { identities: [], title: null };
    }
    return { identities, title: `More ${genreNames[0]} & ${genreNames[1]}` };
  }

  private async buildCollection(client: DbClient, title: TmdbTitleRecord, language?: string | null): Promise<ExtrasListBuildResult> {
    const collection = extractCollection(title);
    if (!collection || typeof collection.id !== 'number') return { identities: [], title: null };
    await this.tmdbCacheService.ensureCollectionCached(client, collection.id, language).catch(() => false);
    const parts = await this.tmdbCacheService.getRelatedTitles(client, 'collection', collection.id, 'collection_part', language);
    if (parts.length === 0) return { identities: [], title: null };
    const identities = parts
      .filter((t) => t.mediaType === 'movie' || t.mediaType === 'tv')
      .map((t) => inferMediaIdentity({ mediaType: t.mediaType === 'movie' ? 'movie' : 'show', tmdbId: t.tmdbId }));
    return { identities, title: collection.name ?? null };
  }
}

function pickTopGenreIds(title: TmdbTitleRecord, max: number): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  const source = Array.isArray(title.genreIds) ? title.genreIds : [];
  for (const value of source) {
    const id = Number(value);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
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
