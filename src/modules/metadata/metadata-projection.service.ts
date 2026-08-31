import type { DbClient } from '../../lib/db.js';
import { MetadataCardService } from './metadata-card.service.js';
import type { MetadataCardView, MetadataTitleMediaType } from './metadata-card.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
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

  async buildWatchProjection(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<WatchMediaProjection> {
    if (identity.mediaType === 'episode') {
      return this.buildEpisodeProjection(client, identity, language);
    }

    return this.buildTitleProjection(client, identity, language);
  }

  async warmCache(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<void> {
    if (identity.mediaType === 'movie' && identity.provider === 'tmdb' && identity.tmdbId) {
      await this.tmdbCacheService.getTitle(client, 'movie', identity.tmdbId, language);
    }
  }

  async resolveNextEpisode(client: DbClient, identity: MediaIdentity): Promise<CanonicalNextEpisodeRef | null> {
    const source = await this.titleSourceService.loadTitleSource(client, identity);

    const tmdbNextEpisode = source.tmdbNextEpisode
      ? this.resolveTmdbNextEpisodeIdentity(identity, source.tmdbNextEpisode)
      : null;
    if (tmdbNextEpisode && source.tmdbNextEpisode) {
      return this.toCanonicalNextEpisodeRef(tmdbNextEpisode, {
        itemId: encodePublicItemId(await this.contentIdentityService.ensureContentId(client, tmdbNextEpisode)),
        airDate: source.tmdbNextEpisode.airDate,
      });
    }

    return null;
  }

  async resolveNextEpisodes(client: DbClient, identities: MediaIdentity[]): Promise<Map<string, CanonicalNextEpisodeRef | null>> {
    const result = new Map<string, CanonicalNextEpisodeRef | null>();
    if (!identities.length) {
      return result;
    }

    const sources = await this.titleSourceService.loadTitleSources(client, identities);

    const nextIdentities: MediaIdentity[] = [];
    const nextKeyBySourceKey = new Map<string, string>();
    for (const identity of identities) {
      const source = sources.get(identity.mediaKey);
      const tmdbNextEpisode = source?.tmdbNextEpisode ?? null;
      const nextIdentity = tmdbNextEpisode ? this.resolveTmdbNextEpisodeIdentity(identity, tmdbNextEpisode) : null;
      if (nextIdentity) {
        nextIdentities.push(nextIdentity);
        nextKeyBySourceKey.set(identity.mediaKey, nextIdentity.mediaKey);
      }
    }

    const nextContentIds = nextIdentities.length
      ? await this.contentIdentityService.ensureContentIds(client, nextIdentities)
      : new Map<string, string>();

    for (const identity of identities) {
      const source = sources.get(identity.mediaKey);
      const tmdbNextEpisode = source?.tmdbNextEpisode ?? null;
      const nextIdentity = tmdbNextEpisode ? this.resolveTmdbNextEpisodeIdentity(identity, tmdbNextEpisode) : null;
      if (!nextIdentity || !tmdbNextEpisode) {
        result.set(identity.mediaKey, null);
        continue;
      }
      const nextContentId = nextContentIds.get(nextIdentity.mediaKey);
      result.set(
        identity.mediaKey,
        nextContentId
          ? this.toCanonicalNextEpisodeRef(nextIdentity, {
            itemId: encodePublicItemId(nextContentId),
            airDate: tmdbNextEpisode.airDate,
          })
          : null,
      );
    }

    return result;
  }

  private async buildTitleProjection(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<WatchMediaProjection> {
    const detailsMedia = await this.buildDisplayCard(client, identity, language);

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
      artworkUrl: detailsMedia.artwork.artwork.medium,
      logoUrl: detailsMedia.images.logo.medium,
      trailerUrl: detailsMedia.trailerUrl,
      trailerThumbnailUrl: detailsMedia.trailerThumbnailUrl,
      posterColor: detailsMedia.posterColor,
      backdropColor: detailsMedia.backdropColor,
      maturityRating: detailsMedia.maturityRating,
      genres: detailsMedia.genres,
    };
  }

  private async buildEpisodeProjection(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<WatchMediaProjection> {
    const parentIdentity = resolveParentIdentity(identity);
    const [parentMedia, episodeMedia] = await Promise.all([
      this.buildDisplayCard(client, parentIdentity, language),
      this.buildDisplayCard(client, identity, language),
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
      episodeStillUrl: episodeMedia.artwork.still.medium,
      title: parentMedia.title,
      subtitle: episodeMedia.subtitle,
      artworkUrl: parentMedia.artwork.artwork.medium,
      logoUrl: parentMedia.images.logo.medium,
      trailerUrl: parentMedia.trailerUrl,
      trailerThumbnailUrl: parentMedia.trailerThumbnailUrl,
      posterColor: parentMedia.posterColor,
      backdropColor: parentMedia.backdropColor,
      maturityRating: parentMedia.maturityRating,
      genres: parentMedia.genres,
    };
  }

  private async buildDisplayCard(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataCardView> {
    return this.metadataCardService.buildCardView(client, identity, language);
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
    params: { itemId: string; airDate: string | null },
  ): CanonicalNextEpisodeRef {
    return {
      itemId: params.itemId,
      airDate: params.airDate,
      seasonNumber: episodeIdentity.seasonNumber,
      episodeNumber: episodeIdentity.episodeNumber,
      absoluteEpisodeNumber: episodeIdentity.absoluteEpisodeNumber ?? null,
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
    detailsOverview: null,
    detailsReleaseDate: null,
    detailsStatus: null,
    detailsRuntimeMinutes: null,
    detailsRating: null,
    episodeTitle: null,
    episodeAirDate: null,
    episodeRuntimeMinutes: null,
    episodeStillUrl: null,
    title: null,
    subtitle: null,
    artworkUrl: null,
    logoUrl: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    maturityRating: null,
    genres: [],
  };
}

function toDetailsSnapshot(media: MetadataCardView): Pick<
  WatchMediaProjection,
  | 'detailsStillUrl'
  | 'detailsReleaseYear'
  | 'detailsOverview'
  | 'detailsReleaseDate'
  | 'detailsStatus'
  | 'detailsRuntimeMinutes'
  | 'detailsRating'
> {
  return {
    detailsStillUrl: media.artwork.still.medium,
    detailsReleaseYear: media.releaseYear,
    detailsOverview: media.overview,
    detailsReleaseDate: media.releaseDate,
    detailsStatus: media.status,
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
