import type { DbClient } from '../../lib/db.js';
import { assertPresent } from '../../lib/errors.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService, episodeRefMapKey } from '../identity/content-identity.service.js';
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

export class MetadataTitleExtrasBuilder {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly titleSourceService = new MetadataTitleSourceService(),
  ) {}

  async buildTitleExtras(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleExtras> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
      throw new Error('Title extras require a title identity.');
    }

    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const resolvedTitle = assertPresent(source.tmdbTitle, 'Metadata title not found.');
    const effectiveLanguage = language ?? null;

    const [episodes, seasons, extrasRaw] = await Promise.all([
      this.buildAllEpisodes(client, resolvedTitle),
      this.buildAllSeasons(client, resolvedTitle),
      this.tmdbCacheService.fetchTitleExtrasPayload(client, resolvedTitle.mediaType, resolvedTitle.tmdbId, effectiveLanguage),
    ]);

    const [reviews, similar, collection] = await Promise.all([
      Promise.resolve(extrasRaw ? extractReviewsFromRaw(extrasRaw) : []),
      this.buildSimilar(client, resolvedTitle, extrasRaw),
      this.buildFullCollection(client, resolvedTitle, effectiveLanguage),
    ]);

    return { Seasons: seasons, Episodes: episodes, Reviews: reviews, Similar: similar, Collection: collection };
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

    return seasonNumbers
      .map((seasonNumber) => {
        const seasonId = seasonIds.get(seasonNumber);
        return seasonId ? buildSeasonBaseItemDto(title, seasonNumber, seasonId) : null;
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

    return episodes.flatMap((episode) => {
      const contentId = episodeIds.get(episodeRefMapKey(
        String(title.tmdbId),
        episode.seasonNumber,
        episode.episodeNumber,
        null,
      ));
      return contentId ? [buildEpisodeBaseItemDto(title, episode, contentId, '')] : [];
    });
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

    return buildDetailBaseItemDto({ identity, title: hydrated, language });
  }
}

function extractSeasonNumbersFromTitle(title: TmdbTitleRecord): number[] {
  const rawSeasons = Array.isArray(title.raw.seasons) ? title.raw.seasons : [];
  return rawSeasons
    .map((entry) => (typeof entry === 'object' && entry !== null ? Number((entry as Record<string, unknown>).season_number) : Number.NaN))
    .filter((seasonNumber) => Number.isInteger(seasonNumber) && seasonNumber >= 0)
    .sort((left, right) => left - right);
}
