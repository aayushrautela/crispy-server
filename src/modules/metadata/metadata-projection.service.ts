import type { DbClient } from '../../lib/db.js';
import { MetadataCardService } from './metadata-card.service.js';
import type { MetadataCardView, MetadataTitleMediaType } from './metadata-card.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import {
  inferMediaIdentity,
  parentMediaTypeForIdentity,
  showTmdbIdForIdentity,
  type MediaIdentity,
  type SupportedProvider,
} from '../identity/media-key.js';
import type { CanonicalNextEpisodeRef } from '../watch/watch-episodic-follow.types.js';
import type { WatchMediaProjection } from '../watch/watch.types.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';
import type { TmdbEpisodeRecord } from './providers/tmdb.types.js';

export class MetadataProjectionService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly metadataCardService = new MetadataCardService(),
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

  async resolveNextEpisode(client: DbClient, identity: MediaIdentity): Promise<CanonicalNextEpisodeRef | null> {
    const source = await this.titleSourceService.loadTitleSource(client, identity);

    const tmdbNextEpisode = source.tmdbNextEpisode
      ? this.resolveTmdbNextEpisodeIdentity(identity, source.tmdbNextEpisode)
      : null;
    if (tmdbNextEpisode && source.tmdbNextEpisode) {
      return this.toCanonicalNextEpisodeRef(tmdbNextEpisode, {
        airDate: source.tmdbNextEpisode.airDate,
        title: source.tmdbNextEpisode.name,
      });
    }

    return null;
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
    return this.metadataCardService.buildCardView(client, identity);
  }

  private resolveTmdbNextEpisodeIdentity(seriesIdentity: MediaIdentity, episode: TmdbEpisodeRecord): MediaIdentity | null {
    if (!seriesIdentity.provider || !seriesIdentity.providerId) {
      return null;
    }

    const showTmdbId = showTmdbIdForIdentity(seriesIdentity);
    if (!showTmdbId) {
      return null;
    }

    return inferMediaIdentity({
      mediaType: 'episode',
      provider: seriesIdentity.provider,
      parentProvider: seriesIdentity.provider,
      parentProviderId: seriesIdentity.providerId,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      providerMetadata: { tmdbId: showTmdbId, showTmdbId },
    });
  }

  private toCanonicalNextEpisodeRef(
    episodeIdentity: MediaIdentity,
    params: { airDate: string | null; title: string | null },
  ): CanonicalNextEpisodeRef {
    return {
      mediaKey: episodeIdentity.mediaKey,
      airDate: params.airDate,
      seasonNumber: episodeIdentity.seasonNumber,
      episodeNumber: episodeIdentity.episodeNumber,
      absoluteEpisodeNumber: episodeIdentity.absoluteEpisodeNumber ?? null,
      title: params.title,
    };
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
    const parentTmdbId = showTmdbIdForIdentity(identity);
    return inferMediaIdentity({
      contentId: identity.parentContentId,
      mediaType: parentMediaType,
      provider: identity.parentProvider ?? undefined,
      providerId: identity.parentProviderId,
      providerMetadata: parentTmdbId ? { tmdbId: parentTmdbId, showTmdbId: parentTmdbId } : undefined,
    });
  }

  if (identity.parentProvider && identity.parentProviderId) {
    const parentTmdbId = showTmdbIdForIdentity(identity);
    return inferMediaIdentity({
      mediaType: parentMediaType,
      provider: identity.parentProvider,
      providerId: identity.parentProviderId,
      providerMetadata: parentTmdbId ? { tmdbId: parentTmdbId, showTmdbId: parentTmdbId } : undefined,
    });
  }

  throw new Error(`Episode identity ${identity.mediaKey} is missing canonical parent title identity.`);
}

function resolveTitleMediaType(mediaType: MediaIdentity['mediaType']): MetadataTitleMediaType {
  if (mediaType === 'movie' || mediaType === 'show') {
    return mediaType;
  }

  return 'show';
}

function resolvePlaybackMediaType(mediaType: MediaIdentity['mediaType']): 'movie' | 'show' | 'episode' | null {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'episode') {
    return mediaType;
  }

  return null;
}
