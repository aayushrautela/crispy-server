import type { DbClient } from '../../lib/db.js';
import { assertPresent } from '../../lib/errors.js';
import {
  ensureSupportedMediaType,
  inferMediaIdentity,
  parentMediaTypeForIdentity,
  parseMediaKey,
  type MediaIdentity,
} from '../identity/media-key.js';
import { ContentIdentityService, episodeRefMapKey } from '../identity/content-identity.service.js';
import {
  buildMetadataCardView,
  buildProviderMetadataCardView,
  toCatalogItem,
} from './metadata-card.builders.js';
import {
  buildEpisodeView,
  buildMetadataView,
  buildProviderEpisodeView,
  buildProviderMetadataView,
  buildProviderSeasonViewFromRecord,
  buildSeasonViewFromRecord,
  buildSeasonViewFromTitleRaw,
} from './metadata-detail.builders.js';
import type {
  CatalogItem,
  MetadataCardView,
  ProviderEpisodeRecord,
  ProviderTitleRecord,
} from './metadata-card.types.js';
import type {
  MetadataCollectionView,
  MetadataProductionInfoView,
  MetadataSeasonDetail,
  MetadataTitleDetail,
  MetadataView,
} from './metadata-detail.types.js';
import {
  extractCast,
  extractCollection,
  extractCollectionParts,
  extractCreators,
  extractCrewByJob,
  extractExternalIds,
  extractProduction,
  extractReviews,
  extractSimilarTitles,
  extractVideos,
} from './metadata-builder.shared.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { TraktClient } from './providers/trakt.client.js';
import { extractNextEpisodeToAir } from './providers/tmdb-episode-helpers.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { TmdbEpisodeRecord, TmdbTitleRecord } from './providers/tmdb.types.js';

export class MetadataDetailCoreService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
    private readonly traktClient = new TraktClient(),
  ) {}

  async buildMetadataView(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataView> {
    const providerContext = await this.providerMetadataService.loadIdentityContext(client, identity, language ?? null);
    if (providerContext?.title) {
      return buildProviderMetadataView({
        identity,
        title: providerContext.title,
        currentEpisode: providerContext.currentEpisode,
        nextEpisode: providerContext.nextEpisode,
      });
    }

    const { title, currentEpisode, nextEpisode } = await this.loadIdentityContext(client, identity);

    return buildMetadataView({
      identity,
      title,
      currentEpisode,
      nextEpisode,
    });
  }

  async getTitleDetail(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleDetail> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
      throw new Error('Title detail normalization requires a title identity.');
    }

    const providerIdentity = this.normalizeProviderTitleIdentity(identity);
    if (providerIdentity) {
      const providerContext = await this.providerMetadataService.loadIdentityContext(client, providerIdentity, language ?? null);
      const resolvedTitle = assertPresent(providerContext?.title, 'Metadata title not found.');
      const seasonIds = await this.contentIdentityService.ensureSeasonContentIds(
        client,
        {
          parentMediaType: resolvedTitle.mediaType === 'anime' ? 'anime' : 'show',
          provider: resolvedTitle.provider,
          parentProviderId: resolvedTitle.providerId,
        },
        providerContext?.seasons.map((season) => season.seasonNumber) ?? [],
      );
      const showTmdbId = resolvedTitle.externalIds.tmdb ?? null;
      const reviews = await this.resolveTitleReviews(
        resolvedTitle.mediaType,
        resolvedTitle.externalIds,
        providerContext?.reviews ?? [],
      );

      return {
        item: buildProviderMetadataView({
          identity: providerIdentity,
          title: resolvedTitle,
          currentEpisode: null,
          nextEpisode: providerContext?.nextEpisode ?? null,
        }),
        seasons: (providerContext?.seasons ?? []).flatMap((season) => {
          const seasonId = seasonIds.get(season.seasonNumber);
          return seasonId
            ? [buildProviderSeasonViewFromRecord(season, seasonId, '', showTmdbId)]
            : [];
        }),
        videos: providerContext?.videos ?? [],
        cast: providerContext?.cast ?? [],
        directors: providerContext?.directors ?? [],
        creators: providerContext?.creators ?? [],
        reviews,
        production: providerContext?.production ?? emptyProductionInfo(),
        collection: providerContext?.collection ?? null,
        similar: await this.buildProviderSimilarCards(client, providerContext?.similar ?? []),
      };
    }

    const { title, nextEpisode } = await this.loadIdentityContext(client, identity);
    const resolvedTitle = assertPresent(title, 'Metadata title not found.');
    const seasonNumbers = extractSeasonNumbersFromTitle(resolvedTitle);
    const seasonIds = await this.contentIdentityService.ensureSeasonContentIds(client, {
      parentMediaType: 'show',
      provider: 'tmdb',
      parentProviderId: resolvedTitle.tmdbId,
    }, seasonNumbers);
    const collection = extractCollection(resolvedTitle);
    const collectionRaw = collection && typeof collection.id === 'number'
      ? await this.tmdbCacheService.getCollection(client, collection.id).catch(() => null)
      : null;
    const collectionParts = extractCollectionParts(collectionRaw);
    const collectionIdentities = collectionParts.map((titleRecord) => inferMediaIdentity({
      mediaType: 'movie',
      tmdbId: titleRecord.tmdbId,
    }));
    const collectionContentIds = await this.contentIdentityService.ensureContentIds(client, collectionIdentities);
    const similarTitles = extractSimilarTitles(resolvedTitle);
    const similarIdentities = similarTitles
      .filter((titleRecord) => titleRecord.mediaType === 'movie')
      .map((titleRecord) => inferMediaIdentity({
        mediaType: 'movie',
        tmdbId: titleRecord.tmdbId,
      }));
    const similarContentIds = await this.contentIdentityService.ensureContentIds(client, similarIdentities);
    const reviews = await this.resolveTitleReviews(
      resolvedTitle.mediaType === 'movie' ? 'movie' : 'show',
      extractExternalIds(resolvedTitle),
      extractReviews(resolvedTitle),
    );

    return {
      item: buildMetadataView({
        identity,
        title: resolvedTitle,
        currentEpisode: null,
        nextEpisode,
      }),
      seasons: buildSeasonViewFromTitleRaw(resolvedTitle, seasonIds),
      videos: extractVideos(resolvedTitle),
      cast: extractCast(resolvedTitle),
      directors: extractCrewByJob(resolvedTitle, 'Director'),
      creators: extractCreators(resolvedTitle),
      reviews,
      production: extractProduction(resolvedTitle),
      collection: collection
        ? {
            ...collection,
            parts: collectionParts.flatMap((titleRecord) => {
              const item = this.buildTmdbCatalogItem(titleRecord, collectionContentIds);
              return item ? [item] : [];
            }),
          }
        : null,
      similar: similarTitles.flatMap((titleRecord) => {
        const item = this.buildTmdbCatalogItem(titleRecord, similarContentIds);
        return item ? [item] : [];
      }),
    };
  }

  async getSeasonDetail(client: DbClient, showIdentity: MediaIdentity, seasonNumber: number, language?: string | null): Promise<MetadataSeasonDetail> {
    const providerContext = await this.providerMetadataService.loadSeasonContext(client, showIdentity, seasonNumber, language ?? null);
    const resolvedTitle = assertPresent(providerContext?.title, 'Show metadata not found.');
    const resolvedSeason = assertPresent(providerContext?.season, 'Season metadata not found.');
    const parentMediaType = resolvedTitle.mediaType === 'anime' ? 'anime' : 'show';
    const seasonId = await this.contentIdentityService.ensureSeasonContentId(client, {
      parentMediaType,
      provider: resolvedSeason.provider,
      parentProviderId: resolvedSeason.parentProviderId,
      seasonNumber,
    });
    const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
      client,
      providerContext?.episodes.map((episode) => ({
        parentMediaType: episode.parentMediaType,
        provider: episode.provider,
        parentProviderId: episode.parentProviderId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
      })) ?? [],
    );

    return {
      show: buildProviderMetadataView({
        identity: this.normalizeProviderTitleIdentity(showIdentity) ?? showIdentity,
        title: resolvedTitle,
        currentEpisode: null,
        nextEpisode: providerContext?.nextEpisode ?? null,
      }),
      season: buildProviderSeasonViewFromRecord(
        resolvedSeason,
        seasonId,
        '',
        resolvedTitle.externalIds.tmdb ?? null,
      ),
      episodes: (providerContext?.episodes ?? []).flatMap((episode) => {
        const contentId = episodeIds.get(episode.providerId);
        return contentId
          ? [buildProviderEpisodeView(resolvedTitle as ProviderTitleRecord, episode, contentId, '')]
          : [];
      }),
    };
  }

  private buildTmdbCatalogItem(title: TmdbTitleRecord, contentIds: Map<string, string>): CatalogItem | null {
    if (title.mediaType !== 'movie') {
      return null;
    }

    const identity = inferMediaIdentity({
      mediaType: 'movie',
      tmdbId: title.tmdbId,
    });
    const contentId = contentIds.get(identity.mediaKey);
    if (!contentId) {
      return null;
    }
    return toCatalogItem(buildMetadataCardView({ identity, title }));
  }

  private async buildProviderSimilarCards(client: DbClient, titles: ProviderTitleRecord[]): Promise<CatalogItem[]> {
    if (!titles.length) {
      return [];
    }

    const identities = titles.map((title) => inferMediaIdentity({
      mediaType: title.mediaType,
      provider: title.provider,
      providerId: title.providerId,
    }));
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

    return titles.flatMap((title) => {
      const identity = inferMediaIdentity({
        mediaType: title.mediaType,
        provider: title.provider,
        providerId: title.providerId,
      });
      const contentId = contentIds.get(identity.mediaKey);
      if (!contentId) {
        return [];
      }
      const item = toCatalogItem(buildProviderMetadataCardView({ identity, title }));
      return item ? [item] : [];
    });
  }

  private async resolveTitleReviews(
    mediaType: 'movie' | 'show' | 'anime',
    externalIds: { imdb: string | null; tmdb: number | null; tvdb: number | null },
    primaryReviews: MetadataTitleDetail['reviews'],
  ): Promise<MetadataTitleDetail['reviews']> {
    const normalizedPrimary = primaryReviews.slice(0, 10);
    if (normalizedPrimary.length >= 3 || !this.traktClient.isConfigured()) {
      return normalizedPrimary;
    }

    const traktMediaType = mediaType === 'movie' ? 'movie' : 'show';
    const fallbackReviews = await this.traktClient.fetchTitleReviews(traktMediaType, externalIds).catch(() => []);
    return mergeReviews(normalizedPrimary, fallbackReviews);
  }

  private async loadIdentityContext(client: DbClient, identity: MediaIdentity): Promise<{
    title: TmdbTitleRecord | null;
    currentEpisode: TmdbEpisodeRecord | null;
    nextEpisode: TmdbEpisodeRecord | null;
  }> {
    const titleType = identity.mediaType === 'movie' ? 'movie' : 'tv';
    const titleTmdbId = identity.mediaType === 'episode' ? identity.showTmdbId : identity.tmdbId;
    const title = titleTmdbId ? await this.tmdbCacheService.getTitle(client, titleType, titleTmdbId) : null;

    let currentEpisode: TmdbEpisodeRecord | null = null;
    let nextEpisode: TmdbEpisodeRecord | null = null;

    if (identity.showTmdbId) {
      const seasonsToEnsure = collectRelevantSeasonNumbers(identity, title);
      for (const seasonNumber of seasonsToEnsure) {
        await this.tmdbCacheService.ensureSeasonCached(client, identity.showTmdbId, seasonNumber);
      }

      const episodes = await this.tmdbCacheService.listEpisodesForShow(client, identity.showTmdbId);
      if (identity.seasonNumber !== null && identity.episodeNumber !== null) {
        currentEpisode = episodes.find(
          (episode) => episode.seasonNumber === identity.seasonNumber && episode.episodeNumber === identity.episodeNumber,
        ) ?? null;
      }
      if (identity.mediaType === 'episode') {
        nextEpisode = selectNextEpisode(identity, title, episodes);
      }
    }

    return {
      title,
      currentEpisode,
      nextEpisode,
    };
  }

  private normalizeProviderTitleIdentity(identity: MediaIdentity): MediaIdentity | null {
    if (identity.mediaType === 'show' || identity.mediaType === 'anime') {
      return identity.provider === 'tvdb' || identity.provider === 'kitsu'
        ? identity
        : null;
    }

    if ((identity.mediaType === 'episode' || identity.mediaType === 'season') && identity.parentProvider && identity.parentProviderId) {
      if (identity.parentProvider !== 'tvdb' && identity.parentProvider !== 'kitsu') {
        return null;
      }

      const mediaType = parentMediaTypeForIdentity(identity);
      if (mediaType !== 'show' && mediaType !== 'anime') {
        return null;
      }

      return inferMediaIdentity({
        mediaType,
        provider: identity.parentProvider,
        providerId: identity.parentProviderId,
        parentContentId: identity.parentContentId ?? null,
      });
    }

    return null;
  }
}

function emptyProductionInfo(): MetadataProductionInfoView {
  return {
    originalLanguage: null,
    originCountries: [],
    spokenLanguages: [],
    productionCountries: [],
    companies: [],
    networks: [],
  };
}

function mergeReviews(primary: MetadataTitleDetail['reviews'], fallback: MetadataTitleDetail['reviews']): MetadataTitleDetail['reviews'] {
  const merged: MetadataTitleDetail['reviews'] = [];
  const seen = new Set<string>();

  for (const review of [...primary, ...fallback]) {
    const dedupeKey = `${review.author ?? ''}:${review.username ?? ''}:${review.content.trim().toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    merged.push(review);
    if (merged.length >= 10) {
      break;
    }
  }

  return merged;
}

function extractSeasonNumbersFromTitle(title: TmdbTitleRecord): number[] {
  const rawSeasons = Array.isArray(title.raw.seasons) ? title.raw.seasons : [];
  return rawSeasons
    .map((entry) => (typeof entry === 'object' && entry !== null ? Number((entry as Record<string, unknown>).season_number) : Number.NaN))
    .filter((seasonNumber) => Number.isInteger(seasonNumber) && seasonNumber >= 0)
    .sort((left, right) => left - right);
}

function collectRelevantSeasonNumbers(identity: MediaIdentity, title: TmdbTitleRecord | null): number[] {
  const seasons = new Set<number>();

  if (identity.seasonNumber && identity.seasonNumber > 0) {
    seasons.add(identity.seasonNumber);
  }

  const nextEpisode = extractNextEpisodeToAir(title);
  if (nextEpisode?.seasonNumber) {
    seasons.add(nextEpisode.seasonNumber);
  }

  if (seasons.size === 0 && title?.numberOfSeasons && title.numberOfSeasons > 0) {
    seasons.add(title.numberOfSeasons);
  }

  return Array.from(seasons).sort((left, right) => left - right);
}

function selectNextEpisode(
  identity: MediaIdentity,
  title: TmdbTitleRecord | null,
  episodes: TmdbEpisodeRecord[],
): TmdbEpisodeRecord | null {
  const tmdbNextEpisode = extractNextEpisodeToAir(title);
  if (tmdbNextEpisode) {
    return tmdbNextEpisode;
  }

  return episodes.find((episode) => {
    if (!episode.airDate || Date.parse(episode.airDate) > Date.now()) {
      return false;
    }
    if (episode.seasonNumber < (identity.seasonNumber ?? 0)) {
      return false;
    }
    if (episode.seasonNumber === identity.seasonNumber && episode.episodeNumber <= (identity.episodeNumber ?? 0)) {
      return false;
    }
    return true;
  }) ?? null;
}
