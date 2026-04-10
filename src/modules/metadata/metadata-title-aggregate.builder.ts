import type { DbClient } from '../../lib/db.js';
import { assertPresent } from '../../lib/errors.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { buildMetadataCardView, buildProviderMetadataCardView, toCatalogItem } from './metadata-card.builders.js';
import type { CatalogItem, ProviderEpisodeRecord, ProviderTitleRecord } from './metadata-card.types.js';
import {
  buildEpisodeView,
  buildMetadataView,
  buildProviderEpisodeView,
  buildProviderMetadataView,
  buildProviderSeasonViewFromRecord,
  buildSeasonViewFromTitleRaw,
} from './metadata-detail.builders.js';
import type {
  MetadataEpisodeView,
  MetadataProductionInfoView,
  MetadataTitleDetail,
} from './metadata-detail.types.js';
import {
  extractCast,
  extractCollection,
  extractCollectionParts,
  extractCreators,
  extractCrewByJob,
  extractProduction,
  extractSimilarTitles,
  extractVideos,
} from './metadata-builder.shared.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { TmdbEpisodeRecord, TmdbTitleRecord } from './providers/tmdb.types.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

export class MetadataTitleAggregateBuilder {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly titleSourceService = new MetadataTitleSourceService(),
  ) {}

  async buildTitleDetail(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleDetail> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
      throw new Error('Title detail normalization requires a title identity.');
    }

    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);

    if (source.providerContext?.title) {
      const providerIdentity = assertPresent(source.providerIdentity, 'Provider identity expected for provider metadata.');
      const providerContext = source.providerContext;
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
      const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
        client,
        (providerContext?.episodes ?? []).map((episode) => ({
          parentMediaType: episode.parentMediaType,
          provider: episode.provider,
          parentProviderId: episode.parentProviderId,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
        })),
      );
      const showTmdbId = resolvedTitle.externalIds.tmdb ?? null;
      const episodes = buildProviderEpisodeViews(resolvedTitle, providerContext?.episodes ?? [], episodeIds);

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
        episodes,
        nextEpisode: selectProviderNextEpisode(episodes, providerContext?.nextEpisode?.providerId ?? null),
        videos: providerContext?.videos ?? [],
        cast: providerContext?.cast ?? [],
        directors: providerContext?.directors ?? [],
        creators: providerContext?.creators ?? [],
        production: providerContext?.production ?? emptyProductionInfo(),
        collection: providerContext?.collection
          ? {
              ...providerContext.collection,
              parts: await this.buildProviderSimilarCards(client, providerContext.collectionItems ?? []),
            }
          : null,
        similar: await this.buildProviderSimilarCards(client, providerContext?.similar ?? []),
      };
    }

    const resolvedTitle = assertPresent(source.tmdbTitle, 'Metadata title not found.');
    const seasonNumbers = extractSeasonNumbersFromTitle(resolvedTitle);
    const seasonIds = await this.contentIdentityService.ensureSeasonContentIds(client, {
      parentMediaType: 'show',
      provider: 'tmdb',
      parentProviderId: resolvedTitle.tmdbId,
    }, seasonNumbers);
    const episodes = await this.buildTmdbEpisodes(client, resolvedTitle);
    const collection = extractCollection(resolvedTitle);
    const collectionRaw = collection && typeof collection.id === 'number'
      ? await this.tmdbCacheService.getCollection(client, collection.id).catch(() => null)
      : null;
    const collectionParts = extractCollectionParts(collectionRaw);
    const collectionIdentities = collectionParts.map((titleRecord) => inferMediaIdentity({ mediaType: 'movie', tmdbId: titleRecord.tmdbId }));
    const collectionContentIds = await this.contentIdentityService.ensureContentIds(client, collectionIdentities);
    const similarTitles = extractSimilarTitles(resolvedTitle);
    const similarIdentities = similarTitles
      .filter((titleRecord) => titleRecord.mediaType === 'movie')
      .map((titleRecord) => inferMediaIdentity({ mediaType: 'movie', tmdbId: titleRecord.tmdbId }));
    const similarContentIds = await this.contentIdentityService.ensureContentIds(client, similarIdentities);

    return {
      item: buildMetadataView({ identity, title: resolvedTitle, currentEpisode: null, nextEpisode: source.tmdbNextEpisode }),
      seasons: buildSeasonViewFromTitleRaw(resolvedTitle, seasonIds),
      episodes,
      nextEpisode: selectTmdbNextEpisode(episodes, source.tmdbNextEpisode),
      videos: extractVideos(resolvedTitle),
      cast: extractCast(resolvedTitle),
      directors: extractCrewByJob(resolvedTitle, 'Director'),
      creators: extractCreators(resolvedTitle),
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

  private async buildTmdbEpisodes(client: DbClient, title: TmdbTitleRecord): Promise<MetadataEpisodeView[]> {
    if (title.mediaType !== 'tv') {
      return [];
    }

    const seasonNumbers = extractSeasonNumbersFromTitle(title).filter((seasonNumber) => seasonNumber > 0);
    for (const seasonNumber of seasonNumbers) {
      await this.tmdbCacheService.ensureSeasonCached(client, title.tmdbId, seasonNumber);
    }

    const episodes = await this.tmdbCacheService.listEpisodesForShow(client, title.tmdbId);
    const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
      client,
      episodes.map((episode) => ({
        parentMediaType: 'show' as const,
        provider: 'tmdb' as const,
        parentProviderId: String(title.tmdbId),
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        absoluteEpisodeNumber: null,
      })),
    );

    return episodes.flatMap((episode) => {
      const providerId = `tmdb:${title.tmdbId}:${episode.seasonNumber}:${episode.episodeNumber}`;
      const contentId = episodeIds.get(providerId);
      return contentId ? [buildEpisodeView(title, episode, contentId, '')] : [];
    });
  }

  private buildTmdbCatalogItem(title: TmdbTitleRecord, contentIds: Map<string, string>): CatalogItem | null {
    if (title.mediaType !== 'movie') {
      return null;
    }

    const identity = inferMediaIdentity({ mediaType: 'movie', tmdbId: title.tmdbId });
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
      const identity = inferMediaIdentity({ mediaType: title.mediaType, provider: title.provider, providerId: title.providerId });
      const contentId = contentIds.get(identity.mediaKey);
      if (!contentId) {
        return [];
      }
      const item = toCatalogItem(buildProviderMetadataCardView({ identity, title }));
      return item ? [item] : [];
    });
  }

}

function buildProviderEpisodeViews(
  title: ProviderTitleRecord,
  episodes: ProviderEpisodeRecord[],
  episodeIds: Map<string, string>,
): MetadataEpisodeView[] {
  return episodes.flatMap((episode) => {
    const contentId = episodeIds.get(episode.providerId);
    return contentId ? [buildProviderEpisodeView(title, episode, contentId, '')] : [];
  });
}

function selectProviderNextEpisode(episodes: MetadataEpisodeView[], providerId: string | null): MetadataEpisodeView | null {
  return providerId ? episodes.find((episode) => episode.providerId === providerId) ?? null : null;
}

function selectTmdbNextEpisode(episodes: MetadataEpisodeView[], nextEpisode: TmdbEpisodeRecord | null): MetadataEpisodeView | null {
  if (!nextEpisode) {
    return null;
  }
  return episodes.find((episode) => (
    episode.showTmdbId === nextEpisode.showTmdbId
    && episode.seasonNumber === nextEpisode.seasonNumber
    && episode.episodeNumber === nextEpisode.episodeNumber
  )) ?? null;
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

function extractSeasonNumbersFromTitle(title: TmdbTitleRecord): number[] {
  const rawSeasons = Array.isArray(title.raw.seasons) ? title.raw.seasons : [];
  return rawSeasons
    .map((entry) => (typeof entry === 'object' && entry !== null ? Number((entry as Record<string, unknown>).season_number) : Number.NaN))
    .filter((seasonNumber) => Number.isInteger(seasonNumber) && seasonNumber >= 0)
    .sort((left, right) => left - right);
}
