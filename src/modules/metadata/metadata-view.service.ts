import type { DbClient } from '../../lib/db.js';
import { ensureSupportedMediaType, inferMediaIdentity, parentMediaTypeForIdentity, type MediaIdentity } from '../watch/media-key.js';
import { assertPresent } from '../../lib/errors.js';
import { ContentIdentityService, episodeRefMapKey } from './content-identity.service.js';
import {
  buildMetadataCardView,
  buildEpisodeView,
  buildMetadataView,
  buildProviderEpisodeView,
  buildProviderMetadataCardView,
  buildProviderMetadataView,
  buildProviderSeasonViewFromRecord,
  buildSeasonViewFromRecord,
  buildSeasonViewFromTitleRaw,
  extractCast,
  extractCollection,
  extractCollectionParts,
  extractCreators,
  extractCrewByJob,
  extractProduction,
  extractReviews,
  extractSimilarTitles,
  extractVideos,
} from './metadata-normalizers.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { extractNextEpisodeToAir } from './tmdb-episode-helpers.js';
import { TmdbCacheService } from './tmdb-cache.service.js';
import type {
  MetadataCardView,
  MetadataCollectionView,
  MetadataProductionInfoView,
  MetadataSeasonDetail,
  MetadataTitleDetail,
  MetadataView,
  ProviderEpisodeRecord,
  ProviderTitleRecord,
} from './metadata.types.js';
import type {
  TmdbEpisodeRecord,
  TmdbTitleRecord,
} from './tmdb.types.js';

export class MetadataViewService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async buildMetadataCardView(client: DbClient, identity: MediaIdentity): Promise<MetadataCardView> {
    const id = await this.contentIdentityService.ensureContentId(client, identity);
    const providerContext = await this.providerMetadataService.loadIdentityContext(client, identity);
    if (providerContext?.title) {
      return buildProviderMetadataCardView({
        id,
        identity,
        title: providerContext.title,
        currentEpisode: providerContext.currentEpisode,
      });
    }

    const context = await this.loadCardContext(client, identity);
    return buildMetadataCardView({
      id,
      identity,
      title: context.title,
      currentEpisode: context.currentEpisode,
    });
  }

  async buildMetadataCardViewFromRow(client: DbClient, row: Record<string, unknown>): Promise<MetadataCardView> {
    const identity = this.identityFromRow(row);
    const id = await this.contentIdentityService.ensureContentId(client, identity);
    const rowTitle = typeof row.title === 'string' && row.title.trim() ? row.title : null;
    const rowSubtitle = typeof row.subtitle === 'string' && row.subtitle.trim() ? row.subtitle : null;
    const rowPosterUrl = typeof row.poster_url === 'string' && row.poster_url.trim() ? row.poster_url : null;
    const rowBackdropUrl = typeof row.backdrop_url === 'string' && row.backdrop_url.trim() ? row.backdrop_url : null;
    const canUseProjectionOnly = Boolean(
      rowTitle
      && (identity.mediaType !== 'episode' || rowSubtitle)
      && (rowPosterUrl || rowBackdropUrl),
    );
    const context = canUseProjectionOnly
      ? { title: null, currentEpisode: null }
      : await this.loadCardContext(client, identity);

    return buildMetadataCardView({
      id,
      identity,
      title: context.title,
      currentEpisode: context.currentEpisode,
      titleOverride: rowTitle,
      subtitleOverride: identity.mediaType === 'episode'
        ? rowSubtitle ?? buildEpisodeSubtitle(identity.seasonNumber, identity.episodeNumber)
        : rowSubtitle,
      posterUrlOverride: rowPosterUrl,
      backdropUrlOverride: rowBackdropUrl,
    });
  }

  async buildMetadataView(client: DbClient, identity: MediaIdentity): Promise<MetadataView> {
    const providerContext = await this.providerMetadataService.loadIdentityContext(client, identity);
    if (providerContext?.title) {
      const id = await this.contentIdentityService.ensureContentId(client, identity);
      const nextEpisodeId = providerContext.nextEpisode
        ? await this.ensureProviderEpisodeContentId(client, providerContext.nextEpisode)
        : null;

      return buildProviderMetadataView({
        id,
        identity,
        title: providerContext.title,
        currentEpisode: providerContext.currentEpisode,
        nextEpisode: providerContext.nextEpisode,
        nextEpisodeId,
      });
    }

    const { title, currentEpisode, nextEpisode } = await this.loadIdentityContext(client, identity);
    const id = await this.contentIdentityService.ensureContentId(client, identity);
    const nextEpisodeId = nextEpisode
      ? await this.contentIdentityService.ensureEpisodeContentId(client, {
          parentMediaType: 'show',
          provider: 'tmdb',
          parentProviderId: nextEpisode.showTmdbId,
          seasonNumber: nextEpisode.seasonNumber,
          episodeNumber: nextEpisode.episodeNumber,
        })
      : null;

    return buildMetadataView({
      id,
      identity,
      title,
      currentEpisode,
      nextEpisode,
      nextEpisodeId,
    });
  }

  async getTitleDetail(client: DbClient, identity: MediaIdentity): Promise<MetadataTitleDetail> {
    const providerIdentity = this.normalizeProviderTitleIdentity(identity);
    if (providerIdentity) {
      const providerContext = await this.providerMetadataService.loadIdentityContext(client, providerIdentity);
      const resolvedTitle = assertPresent(providerContext?.title, 'Metadata title not found.');
      const showId = await this.contentIdentityService.ensureContentId(client, providerIdentity);
      const seasonIds = await this.contentIdentityService.ensureSeasonContentIds(client, {
        parentMediaType: resolvedTitle.mediaType === 'anime' ? 'anime' : 'show',
        provider: resolvedTitle.provider,
        parentProviderId: resolvedTitle.providerId,
      }, providerContext?.seasons.map((season) => season.seasonNumber) ?? []);
      const nextEpisodeId = providerContext?.nextEpisode
        ? await this.ensureProviderEpisodeContentId(client, providerContext.nextEpisode)
        : null;
      const showTmdbId = resolvedTitle.externalIds.tmdb ?? null;

      return {
        item: buildProviderMetadataView({
          id: showId,
          identity: providerIdentity,
          title: resolvedTitle,
          currentEpisode: null,
          nextEpisode: providerContext?.nextEpisode ?? null,
          nextEpisodeId,
        }),
        seasons: (providerContext?.seasons ?? []).flatMap((season) => {
          const seasonId = seasonIds.get(season.seasonNumber);
          return seasonId
            ? [buildProviderSeasonViewFromRecord(season, seasonId, showId, showTmdbId)]
            : [];
        }),
        videos: providerContext?.videos ?? [],
        cast: providerContext?.cast ?? [],
        directors: providerContext?.directors ?? [],
        creators: providerContext?.creators ?? [],
        reviews: providerContext?.reviews ?? [],
        production: providerContext?.production ?? emptyProductionInfo(),
        collection: providerContext?.collection ?? null,
        similar: await this.buildProviderSimilarCards(client, providerContext?.similar ?? []),
      };
    }

    const normalizedIdentity = identity.mediaType === 'episode'
      ? { ...identity, mediaType: 'show' as const, tmdbId: identity.showTmdbId, seasonNumber: null, episodeNumber: null }
      : identity;
    const { title, nextEpisode } = await this.loadIdentityContext(client, normalizedIdentity);
    const resolvedTitle = assertPresent(title, 'Metadata title not found.');
    const showId = await this.contentIdentityService.ensureContentId(client, normalizedIdentity);
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
    const collectionIdentities = collectionParts.map((title) => inferMediaIdentity({
      mediaType: 'movie',
      tmdbId: title.tmdbId,
    }));
    const collectionContentIds = await this.contentIdentityService.ensureContentIds(client, collectionIdentities);
    const similarTitles = extractSimilarTitles(resolvedTitle);
    const similarIdentities = similarTitles.map((title) => inferMediaIdentity({
      mediaType: title.mediaType === 'movie' ? 'movie' : 'show',
      tmdbId: title.tmdbId,
    }));
    const similarContentIds = await this.contentIdentityService.ensureContentIds(client, similarIdentities);
    const nextEpisodeId = nextEpisode
      ? await this.contentIdentityService.ensureEpisodeContentId(client, {
          parentMediaType: 'show',
          provider: 'tmdb',
          parentProviderId: nextEpisode.showTmdbId,
          seasonNumber: nextEpisode.seasonNumber,
          episodeNumber: nextEpisode.episodeNumber,
        })
      : null;

    return {
      item: buildMetadataView({
        id: showId,
        identity: normalizedIdentity,
        title: resolvedTitle,
        currentEpisode: null,
        nextEpisode,
        nextEpisodeId,
      }),
      seasons: buildSeasonViewFromTitleRaw(resolvedTitle, showId, seasonIds),
      videos: extractVideos(resolvedTitle),
      cast: extractCast(resolvedTitle),
      directors: extractCrewByJob(resolvedTitle, 'Director'),
      creators: extractCreators(resolvedTitle),
      reviews: extractReviews(resolvedTitle),
      production: extractProduction(resolvedTitle),
      collection: collection
        ? {
            ...collection,
            parts: collectionParts.flatMap((title) => {
              const identity = inferMediaIdentity({ mediaType: 'movie', tmdbId: title.tmdbId });
              const contentId = collectionContentIds.get(identity.mediaKey);
              return contentId
                ? [buildMetadataCardView({ id: contentId, identity, title })]
                : [];
            }),
          }
        : null,
      similar: similarTitles.flatMap((title) => {
        const identity = inferMediaIdentity({
          mediaType: title.mediaType === 'movie' ? 'movie' : 'show',
          tmdbId: title.tmdbId,
        });
        const contentId = similarContentIds.get(identity.mediaKey);
        return contentId
          ? [buildMetadataCardView({ id: contentId, identity, title })]
          : [];
      }),
    };
  }

  async getSeasonDetail(client: DbClient, showIdentity: MediaIdentity, seasonNumber: number): Promise<MetadataSeasonDetail> {
    const providerContext = await this.providerMetadataService.loadSeasonContext(client, showIdentity, seasonNumber);
    if (providerContext?.title && providerContext.season) {
      const providerShowId = await this.contentIdentityService.ensureContentId(client, this.normalizeProviderTitleIdentity(showIdentity) ?? showIdentity);
      const parentMediaType = providerContext.title.mediaType === 'anime' ? 'anime' : 'show';
      const seasonId = await this.contentIdentityService.ensureSeasonContentId(client, {
        parentMediaType,
        provider: providerContext.season.provider,
        parentProviderId: providerContext.season.parentProviderId,
        seasonNumber,
      });
      const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
        client,
        providerContext.episodes.map((episode) => ({
          parentMediaType: episode.parentMediaType,
          provider: episode.provider,
          parentProviderId: episode.parentProviderId,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
        })),
      );
      const nextEpisodeId = providerContext.nextEpisode
        ? await this.ensureProviderEpisodeContentId(client, providerContext.nextEpisode)
        : null;

      return {
        show: buildProviderMetadataView({
          id: providerShowId,
          identity: this.normalizeProviderTitleIdentity(showIdentity) ?? showIdentity,
          title: providerContext.title,
          currentEpisode: null,
          nextEpisode: providerContext.nextEpisode,
          nextEpisodeId,
        }),
        season: buildProviderSeasonViewFromRecord(
          providerContext.season,
          seasonId,
          providerShowId,
          providerContext.title.externalIds.tmdb ?? null,
        ),
        episodes: providerContext.episodes.flatMap((episode) => {
          const contentId = episodeIds.get(episode.providerId);
          return contentId
            ? [buildProviderEpisodeView(providerContext.title as ProviderTitleRecord, episode, contentId, providerShowId)]
            : [];
        }),
      };
    }

    const showTmdbId = assertPresent(showIdentity.tmdbId, 'Season details require a TMDB-backed show id.');

    const { title, nextEpisode } = await this.loadIdentityContext(client, showIdentity);
    const resolvedTitle = assertPresent(title, 'Show metadata not found.');
    const seasonRecord = await this.tmdbCacheService.ensureSeasonCached(client, showTmdbId, seasonNumber);
    const resolvedSeason = assertPresent(seasonRecord, 'Season metadata not found.');
    const episodes = await this.tmdbCacheService.listEpisodesForSeason(client, showTmdbId, seasonNumber);
    const showId = await this.contentIdentityService.ensureTitleContentId(client, {
      mediaType: 'show',
      provider: 'tmdb',
      providerId: showTmdbId,
    });
    const seasonId = await this.contentIdentityService.ensureSeasonContentId(client, {
      parentMediaType: 'show',
      provider: 'tmdb',
      parentProviderId: showTmdbId,
      seasonNumber,
    });
    const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
      client,
      episodes.map((episode) => ({
        parentMediaType: 'show' as const,
        provider: 'tmdb' as const,
        parentProviderId: episode.showTmdbId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
      })),
    );
    const nextEpisodeId = nextEpisode
      ? await this.contentIdentityService.ensureEpisodeContentId(client, {
          parentMediaType: 'show',
          provider: 'tmdb',
          parentProviderId: nextEpisode.showTmdbId,
          seasonNumber: nextEpisode.seasonNumber,
          episodeNumber: nextEpisode.episodeNumber,
        })
      : null;

    return {
      show: buildMetadataView({
        id: showId,
        identity: showIdentity,
        title: resolvedTitle,
        currentEpisode: null,
        nextEpisode,
        nextEpisodeId,
      }),
      season: buildSeasonViewFromRecord(showTmdbId, resolvedSeason, seasonId, showId),
      episodes: episodes.map((episode) => buildEpisodeView(
        resolvedTitle,
        episode,
        assertPresent(
          episodeIds.get(episodeRefMapKey(episode.showTmdbId, episode.seasonNumber, episode.episodeNumber)),
          'Episode metadata not found.',
        ),
        showId,
      )),
    };
  }

  async buildViews(client: DbClient, identities: MediaIdentity[]): Promise<MetadataView[]> {
    return Promise.all(identities.map((identity) => this.buildMetadataView(client, identity)));
  }

  async buildCardViews(client: DbClient, identities: MediaIdentity[]): Promise<MetadataCardView[]> {
    return Promise.all(identities.map((identity) => this.buildMetadataCardView(client, identity)));
  }

  private async loadCardContext(client: DbClient, identity: MediaIdentity): Promise<{
    title: TmdbTitleRecord | null;
    currentEpisode: TmdbEpisodeRecord | null;
  }> {
    const titleType = identity.mediaType === 'movie' ? 'movie' : 'tv';
    const titleTmdbId = identity.mediaType === 'episode' ? identity.showTmdbId : identity.tmdbId;
    const title = titleTmdbId ? await this.tmdbCacheService.getTitle(client, titleType, titleTmdbId) : null;

    let currentEpisode: TmdbEpisodeRecord | null = null;
    if (identity.mediaType === 'episode' && identity.showTmdbId && identity.seasonNumber !== null && identity.episodeNumber !== null) {
      currentEpisode = await this.tmdbCacheService.getEpisode(client, identity.showTmdbId, identity.seasonNumber, identity.episodeNumber);
    }

    return { title, currentEpisode };
  }

  private identityFromRow(row: Record<string, unknown>): MediaIdentity {
    return inferMediaIdentity({
      mediaKey: String(row.media_key),
      mediaType: ensureSupportedMediaType(String(row.media_type)),
      tmdbId: row.tmdb_id === null || row.tmdb_id === undefined ? null : Number(row.tmdb_id),
      showTmdbId: row.show_tmdb_id === null || row.show_tmdb_id === undefined ? null : Number(row.show_tmdb_id),
      seasonNumber: row.season_number === null || row.season_number === undefined ? null : Number(row.season_number),
      episodeNumber: row.episode_number === null || row.episode_number === undefined ? null : Number(row.episode_number),
    });
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

  private ensureProviderEpisodeContentId(client: DbClient, episode: ProviderEpisodeRecord): Promise<string> {
    return this.contentIdentityService.ensureEpisodeContentId(client, {
      parentMediaType: episode.parentMediaType,
      provider: episode.provider,
      parentProviderId: episode.parentProviderId,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
    });
  }

  private async buildProviderSimilarCards(client: DbClient, titles: ProviderTitleRecord[]): Promise<MetadataCardView[]> {
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
      return contentId
        ? [buildProviderMetadataCardView({ id: contentId, identity, title })]
        : [];
    });
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

function extractSeasonNumbersFromTitle(title: TmdbTitleRecord): number[] {
  const rawSeasons = Array.isArray(title.raw.seasons) ? title.raw.seasons : [];
  return rawSeasons
    .map((entry) => (typeof entry === 'object' && entry !== null ? Number((entry as Record<string, unknown>).season_number) : NaN))
    .filter((seasonNumber) => Number.isInteger(seasonNumber) && seasonNumber >= 0)
    .sort((left, right) => left - right);
}

function buildEpisodeSubtitle(seasonNumber: number | null, episodeNumber: number | null): string | null {
  if (seasonNumber === null || episodeNumber === null) {
    return null;
  }

  return `S${String(seasonNumber).padStart(2, '0')} E${String(episodeNumber).padStart(2, '0')}`;
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
