import type { DbClient } from '../../lib/db.js';
import { buildMetadataCardView, buildProviderMetadataCardView } from './metadata-normalizers.js';
import type { MetadataCardView, MetadataTitleMediaType } from './metadata.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import {
  inferMediaIdentity,
  parentMediaTypeForIdentity,
  showTmdbIdForIdentity,
  type MediaIdentity,
  type SupportedProvider,
} from '../identity/media-key.js';
import type { WatchMediaProjection } from '../watch/watch.types.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { extractNextEpisodeToAir } from './providers/tmdb-episode-helpers.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';

export class MetadataProjectionService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async buildWatchProjection(client: DbClient, identity: MediaIdentity): Promise<WatchMediaProjection> {
    if (identity.mediaType === 'episode') {
      return this.buildEpisodeProjection(client, identity);
    }

    return this.buildTitleProjection(client, identity);
  }

  async warmCache(client: DbClient, identity: MediaIdentity): Promise<void> {
    if (identity.mediaType === 'movie' && identity.provider === 'tmdb' && identity.tmdbId) {
      await this.tmdbCacheService.getTitle(client, 'movie', identity.tmdbId);
    }
  }

  async resolveNextEpisodeAirDate(client: DbClient, identity: MediaIdentity): Promise<string | null> {
    if (identity.provider === 'tmdb') {
      const showTmdbId = showTmdbIdForIdentity(identity);
      if (!showTmdbId) {
        return null;
      }

      const title = await this.tmdbCacheService.getTitle(client, 'tv', showTmdbId);
      return extractNextEpisodeToAir(title)?.airDate ?? null;
    }

    const context = await this.providerMetadataService.loadIdentityContext(client, identity);
    return context?.nextEpisode?.airDate ?? null;
  }

  private async buildTitleProjection(client: DbClient, identity: MediaIdentity): Promise<WatchMediaProjection> {
    const [detailsTitleId, detailsMedia] = await Promise.all([
      this.contentIdentityService.ensureContentId(client, identity),
      this.buildDisplayCard(client, identity),
    ]);

    return {
      ...emptyProjection(),
      detailsTitleId,
      detailsTitleMediaType: resolveTitleMediaType(identity.mediaType),
      playbackContentId: resolveDirectPlaybackContentId(identity, detailsTitleId),
      playbackMediaType: resolvePlaybackMediaType(identity.mediaType),
      playbackProvider: identity.provider ?? null,
      playbackProviderId: identity.providerId ?? null,
      playbackParentProvider: identity.parentProvider ?? null,
      playbackParentProviderId: identity.parentProviderId ?? null,
      playbackSeasonNumber: identity.seasonNumber,
      playbackEpisodeNumber: identity.episodeNumber,
      playbackAbsoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? null,
      ...toDetailsSnapshot(detailsMedia),
      title: detailsMedia.title,
      subtitle: detailsMedia.subtitle,
      posterUrl: detailsMedia.artwork.posterUrl,
      backdropUrl: detailsMedia.artwork.backdropUrl,
    };
  }

  private async buildEpisodeProjection(client: DbClient, identity: MediaIdentity): Promise<WatchMediaProjection> {
    const parentIdentity = resolveParentIdentity(identity);
    const [detailsTitleId, highlightEpisodeId, parentMedia, episodeMedia] = await Promise.all([
      this.contentIdentityService.ensureContentId(client, parentIdentity),
      this.contentIdentityService.ensureContentId(client, identity),
      this.buildDisplayCard(client, parentIdentity),
      this.buildDisplayCard(client, identity),
    ]);

    return {
      ...emptyProjection(),
      detailsTitleId,
      detailsTitleMediaType: resolveTitleMediaType(parentIdentity.mediaType),
      highlightEpisodeId,
      playbackContentId: highlightEpisodeId,
      playbackMediaType: 'episode',
      playbackProvider: identity.provider ?? null,
      playbackProviderId: identity.providerId ?? null,
      playbackParentProvider: identity.parentProvider ?? null,
      playbackParentProviderId: identity.parentProviderId ?? null,
      playbackSeasonNumber: identity.seasonNumber,
      playbackEpisodeNumber: identity.episodeNumber,
      playbackAbsoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? null,
      ...toDetailsSnapshot(parentMedia),
      episodeTitle: episodeMedia.title,
      episodeAirDate: episodeMedia.releaseDate,
      episodeRuntimeMinutes: episodeMedia.runtimeMinutes,
      episodeStillUrl: episodeMedia.artwork.stillUrl,
      episodeOverview: episodeMedia.overview,
      title: parentMedia.title,
      subtitle: episodeMedia.subtitle,
      posterUrl: parentMedia.artwork.posterUrl,
      backdropUrl: parentMedia.artwork.backdropUrl,
    };
  }

  private async buildDisplayCard(client: DbClient, identity: MediaIdentity): Promise<MetadataCardView> {
    const contentIdPromise = this.contentIdentityService.ensureContentId(client, identity);
    const providerContext = await this.providerMetadataService.loadIdentityContext(client, identity).catch(() => null);

    if (providerContext?.title) {
      const contentId = await contentIdPromise;
      return buildProviderMetadataCardView({
        id: contentId,
        identity,
        title: providerContext.title,
        currentEpisode: providerContext.currentEpisode,
      });
    }

    const contentId = await contentIdPromise;
    const tmdbContext = await this.loadTmdbCardContext(client, identity).catch(() => ({ title: null, currentEpisode: null }));
    return buildMetadataCardView({
      id: contentId,
      identity,
      title: tmdbContext.title,
      currentEpisode: tmdbContext.currentEpisode,
    });
  }

  private async loadTmdbCardContext(
    client: DbClient,
    identity: MediaIdentity,
  ): Promise<{ title: Awaited<ReturnType<TmdbCacheService['getTitle']>> | null; currentEpisode: Awaited<ReturnType<TmdbCacheService['getEpisode']>> | null }> {
    if (identity.mediaType === 'movie' && identity.tmdbId) {
      return {
        title: await this.tmdbCacheService.getTitle(client, 'movie', identity.tmdbId),
        currentEpisode: null,
      };
    }

    if ((identity.mediaType === 'show' || identity.mediaType === 'anime') && identity.tmdbId) {
      return {
        title: await this.tmdbCacheService.getTitle(client, 'tv', identity.tmdbId),
        currentEpisode: null,
      };
    }

    const showTmdbId = showTmdbIdForIdentity(identity);
    if ((identity.mediaType === 'episode' || identity.mediaType === 'season') && showTmdbId) {
      const [title, currentEpisode] = await Promise.all([
        this.tmdbCacheService.getTitle(client, 'tv', showTmdbId),
        identity.mediaType === 'episode' && identity.seasonNumber !== null && identity.episodeNumber !== null
          ? this.tmdbCacheService.getEpisode(client, showTmdbId, identity.seasonNumber, identity.episodeNumber)
          : Promise.resolve(null),
      ]);

      return { title, currentEpisode };
    }

    return { title: null, currentEpisode: null };
  }
}

function emptyProjection(): WatchMediaProjection {
  return {
    detailsTitleId: null,
    detailsTitleMediaType: null,
    highlightEpisodeId: null,
    playbackContentId: null,
    playbackMediaType: null,
    playbackProvider: null,
    playbackProviderId: null,
    playbackParentProvider: null,
    playbackParentProviderId: null,
    playbackSeasonNumber: null,
    playbackEpisodeNumber: null,
    playbackAbsoluteEpisodeNumber: null,
    detailsTitle: null,
    detailsSubtitle: null,
    detailsSummary: null,
    detailsOverview: null,
    detailsPosterUrl: null,
    detailsBackdropUrl: null,
    detailsStillUrl: null,
    detailsReleaseDate: null,
    detailsReleaseYear: null,
    detailsRuntimeMinutes: null,
    detailsRating: null,
    detailsStatus: null,
    detailsProvider: null,
    detailsProviderId: null,
    detailsParentProvider: null,
    detailsParentProviderId: null,
    detailsTmdbId: null,
    detailsShowTmdbId: null,
    episodeTitle: null,
    episodeAirDate: null,
    episodeRuntimeMinutes: null,
    episodeStillUrl: null,
    episodeOverview: null,
    title: null,
    subtitle: null,
    posterUrl: null,
    backdropUrl: null,
  };
}

function toDetailsSnapshot(media: MetadataCardView): Pick<
  WatchMediaProjection,
  | 'detailsTitle'
  | 'detailsSubtitle'
  | 'detailsSummary'
  | 'detailsOverview'
  | 'detailsPosterUrl'
  | 'detailsBackdropUrl'
  | 'detailsStillUrl'
  | 'detailsReleaseDate'
  | 'detailsReleaseYear'
  | 'detailsRuntimeMinutes'
  | 'detailsRating'
  | 'detailsStatus'
  | 'detailsProvider'
  | 'detailsProviderId'
  | 'detailsParentProvider'
  | 'detailsParentProviderId'
  | 'detailsTmdbId'
  | 'detailsShowTmdbId'
> {
  return {
    detailsTitle: media.title,
    detailsSubtitle: media.subtitle,
    detailsSummary: media.summary,
    detailsOverview: media.overview,
    detailsPosterUrl: media.artwork.posterUrl,
    detailsBackdropUrl: media.artwork.backdropUrl,
    detailsStillUrl: media.artwork.stillUrl,
    detailsReleaseDate: media.releaseDate,
    detailsReleaseYear: media.releaseYear,
    detailsRuntimeMinutes: media.runtimeMinutes,
    detailsRating: media.rating,
    detailsStatus: media.status,
    detailsProvider: media.provider,
    detailsProviderId: media.providerId,
    detailsParentProvider: media.parentProvider,
    detailsParentProviderId: media.parentProviderId,
    detailsTmdbId: media.tmdbId,
    detailsShowTmdbId: media.showTmdbId,
  };
}

function resolveParentIdentity(identity: MediaIdentity): MediaIdentity {
  const parentMediaType = parentMediaTypeForIdentity(identity);

  if (identity.parentContentId) {
    return inferMediaIdentity({
      contentId: identity.parentContentId,
      mediaType: parentMediaType,
      provider: identity.parentProvider ?? undefined,
      providerId: identity.parentProviderId,
      tmdbId: identity.parentProvider === 'tmdb' ? showTmdbIdForIdentity(identity) : null,
      showTmdbId: identity.parentProvider === 'tmdb' ? showTmdbIdForIdentity(identity) : null,
    });
  }

  if (identity.parentProvider && identity.parentProviderId) {
    return inferMediaIdentity({
      mediaType: parentMediaType,
      provider: identity.parentProvider,
      providerId: identity.parentProviderId,
      tmdbId: identity.parentProvider === 'tmdb' ? showTmdbIdForIdentity(identity) : null,
      showTmdbId: identity.parentProvider === 'tmdb' ? showTmdbIdForIdentity(identity) : null,
    });
  }

  throw new Error(`Episode identity ${identity.mediaKey} is missing canonical parent title identity.`);
}

function resolveTitleMediaType(mediaType: MediaIdentity['mediaType']): MetadataTitleMediaType {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'anime') {
    return mediaType;
  }

  return mediaType === 'season' || mediaType === 'episode' ? 'show' : 'movie';
}

function resolvePlaybackMediaType(mediaType: MediaIdentity['mediaType']): 'movie' | 'show' | 'episode' | 'anime' | null {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'anime' || mediaType === 'episode') {
    return mediaType;
  }

  return null;
}

function resolveDirectPlaybackContentId(identity: MediaIdentity, contentId: string): string | null {
  if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return contentId;
  }

  return null;
}
