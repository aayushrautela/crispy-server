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
    const detailsMedia = await this.buildDisplayCard(client, identity);

    return {
      ...emptyProjection(),
      detailsTitleMediaType: resolveTitleMediaType(identity.mediaType),
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
    const [parentMedia, episodeMedia] = await Promise.all([
      this.buildDisplayCard(client, parentIdentity),
      this.buildDisplayCard(client, identity),
    ]);

    return {
      ...emptyProjection(),
      detailsTitleMediaType: resolveTitleMediaType(parentIdentity.mediaType),
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
      title: parentMedia.title,
      subtitle: episodeMedia.subtitle,
      posterUrl: parentMedia.artwork.posterUrl,
      backdropUrl: parentMedia.artwork.backdropUrl,
    };
  }

  private async buildDisplayCard(client: DbClient, identity: MediaIdentity): Promise<MetadataCardView> {
    const providerContext = await this.providerMetadataService.loadIdentityContext(client, identity).catch(() => null);

    if (providerContext?.title) {
      return buildProviderMetadataCardView({
        identity,
        title: providerContext.title,
        currentEpisode: providerContext.currentEpisode,
      });
    }

    const tmdbContext = await this.loadTmdbCardContext(client, identity).catch(() => ({ title: null, currentEpisode: null }));
    return buildMetadataCardView({
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
    detailsTitleMediaType: null,
    playbackMediaType: null,
    playbackProvider: null,
    playbackProviderId: null,
    playbackParentProvider: null,
    playbackParentProviderId: null,
    playbackSeasonNumber: null,
    playbackEpisodeNumber: null,
    playbackAbsoluteEpisodeNumber: null,
    detailsStillUrl: null,
    detailsReleaseYear: null,
    detailsRuntimeMinutes: null,
    detailsRating: null,
    episodeTitle: null,
    episodeAirDate: null,
    episodeRuntimeMinutes: null,
    episodeStillUrl: null,
    title: null,
    subtitle: null,
    posterUrl: null,
    backdropUrl: null,
  };
}

function toDetailsSnapshot(media: MetadataCardView): Pick<
  WatchMediaProjection,
  | 'detailsStillUrl'
  | 'detailsReleaseYear'
  | 'detailsRuntimeMinutes'
  | 'detailsRating'
> {
  return {
    detailsStillUrl: media.artwork.stillUrl,
    detailsReleaseYear: media.releaseYear,
    detailsRuntimeMinutes: media.runtimeMinutes,
    detailsRating: media.rating,
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
