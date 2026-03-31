import type { DbClient } from '../../lib/db.js';
import { inferMediaIdentity, type SupportedProvider } from '../identity/media-key.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import type { MetadataCardView, MetadataTitleMediaType } from '../metadata/metadata.types.js';
import type { DetailsTarget, EpisodeContext, PlaybackTarget, WatchDerivedProductItem } from './watch-derived-item.types.js';

export class WatchDerivedItemBuilder {
  constructor(
    private readonly metadataCardService = new MetadataCardService(),
  ) {}

  async buildProductItem(client: DbClient, media: MetadataCardView): Promise<WatchDerivedProductItem> {
    if (media.kind === 'episode') {
      return this.buildEpisodeDerivedItem(client, media);
    }

    const titleMediaType = resolveTitleMediaType(media.mediaType);
    return {
      media,
      detailsTarget: {
        kind: 'title',
        titleId: media.id,
        titleMediaType,
        highlightEpisodeId: null,
      },
      playbackTarget: buildPlaybackTarget(media),
      episodeContext: null,
    };
  }

  private async buildEpisodeDerivedItem(client: DbClient, episode: MetadataCardView): Promise<WatchDerivedProductItem> {
    const parentIdentity = resolveParentIdentity(episode);
    const parentCard = parentIdentity
      ? await this.metadataCardService.buildCardView(client, parentIdentity).catch(() => null)
      : null;

    const media = parentCard ?? episode;
    const titleMediaType = parentCard
      ? resolveTitleMediaType(parentCard.mediaType)
      : (episode.parentMediaType as MetadataTitleMediaType) ?? 'show';

    return {
      media,
      detailsTarget: {
        kind: 'title',
        titleId: parentCard?.id ?? episode.parentProviderId ?? episode.id,
        titleMediaType,
        highlightEpisodeId: episode.id,
      },
      playbackTarget: buildPlaybackTarget(episode),
      episodeContext: buildEpisodeContext(episode),
    };
  }
}

function resolveParentIdentity(episode: MetadataCardView) {
  if (episode.showTmdbId) {
    return inferMediaIdentity({
      mediaType: episode.parentMediaType ?? 'show',
      provider: 'tmdb',
      providerId: episode.showTmdbId,
      tmdbId: episode.showTmdbId,
    });
  }

  if (episode.parentProvider && episode.parentProviderId) {
    return inferMediaIdentity({
      mediaType: episode.parentMediaType ?? (episode.parentProvider === 'kitsu' ? 'anime' : 'show'),
      provider: episode.parentProvider,
      providerId: episode.parentProviderId,
    });
  }

  return null;
}

function resolveTitleMediaType(mediaType: string): MetadataTitleMediaType {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'anime') {
    return mediaType;
  }
  return 'show';
}

function buildPlaybackTarget(media: MetadataCardView): PlaybackTarget | null {
  return {
    contentId: media.id,
    mediaType: media.mediaType,
    provider: media.provider ?? null,
    providerId: media.providerId ?? null,
    parentProvider: media.parentProvider ?? null,
    parentProviderId: media.parentProviderId ?? null,
    seasonNumber: media.seasonNumber,
    episodeNumber: media.episodeNumber,
    absoluteEpisodeNumber: media.absoluteEpisodeNumber,
  };
}

function buildEpisodeContext(episode: MetadataCardView): EpisodeContext {
  return {
    episodeId: episode.id,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
    title: episode.title,
    airDate: episode.releaseDate,
    runtimeMinutes: episode.runtimeMinutes,
    stillUrl: episode.artwork.stillUrl,
    overview: episode.overview,
  };
}
