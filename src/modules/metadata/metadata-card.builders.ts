import {
  parentMediaTypeForIdentity,
  type MediaIdentity,
} from '../identity/media-key.js';
import type { MetadataParentMediaType } from './metadata-card.types.js';
import type {
  CatalogItem,
  MetadataCardView,
  MetadataEpisodePreview,
} from './metadata-card.types.js';
import type { TmdbEpisodeRecord, TmdbTitleRecord } from './providers/tmdb.types.js';
import {
  buildMetadataImages,
  deriveRuntimeMinutes,
  extractRating,
  extractReleaseDate,
  extractReleaseYear,
  metadataMediaTypeFromTitle,
  padded,
} from './metadata-builder.shared.js';

function resolveProviderParentMediaType(identity: MediaIdentity): MetadataParentMediaType | null {
  if (identity.mediaType !== 'episode' && identity.mediaType !== 'season') {
    return null;
  }

  return parentMediaTypeForIdentity(identity) === 'show' ? 'show' : null;
}

export function toCatalogItem(card: MetadataCardView): CatalogItem | null {
  const posterUrl = card.images.posterUrl ?? card.artwork.posterUrl;
  if (!card.title || !posterUrl) {
    return null;
  }

  return {
    mediaType: card.mediaType,
    mediaKey: card.mediaKey,
    title: card.title,
    posterUrl,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genre: null,
    subtitle: card.subtitle,
  };
}

export function buildEpisodePreview(title: TmdbTitleRecord, episode: TmdbEpisodeRecord): MetadataEpisodePreview {
  return {
    mediaType: 'episode',
    mediaKey: `episode:tmdb:${episode.showTmdbId}:${episode.seasonNumber}:${episode.episodeNumber}`,
    parentMediaType: 'show',
    tmdbId: episode.tmdbId,
    showTmdbId: episode.showTmdbId,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    absoluteEpisodeNumber: null,
    title: episode.name,
    summary: episode.overview,
    airDate: episode.airDate,
    runtimeMinutes: deriveRuntimeMinutes(title, episode),
    rating: episode.voteAverage,
    images: buildMetadataImages(title, episode),
  };
}

export function buildMetadataCardView(params: {
  identity: MediaIdentity;
  title: TmdbTitleRecord | null;
  currentEpisode?: TmdbEpisodeRecord | null;
  titleOverride?: string | null;
  subtitleOverride?: string | null;
  posterUrlOverride?: string | null;
  backdropUrlOverride?: string | null;
}): MetadataCardView {
  const { identity, title, currentEpisode = null } = params;
  const releaseDate = extractReleaseDate(title, currentEpisode);
  const images = buildMetadataImages(title, currentEpisode);
  const artwork = {
    posterUrl: params.posterUrlOverride ?? images.posterUrl,
    backdropUrl: params.backdropUrlOverride ?? images.backdropUrl,
    stillUrl: images.stillUrl,
  };
  const resolvedMediaType = identity.mediaType === 'show' || identity.mediaType === 'episode'
    ? identity.mediaType
    : 'movie';
  const titleName = params.titleOverride
    ?? (resolvedMediaType === 'episode'
      ? title?.name ?? title?.originalName ?? currentEpisode?.name ?? null
      : currentEpisode?.name ?? title?.name ?? title?.originalName ?? null);
  const subtitle = params.subtitleOverride
    ?? (resolvedMediaType === 'episode'
      ? currentEpisode?.name
        ?? (identity.seasonNumber !== null && identity.episodeNumber !== null
          ? `S${padded(identity.seasonNumber)} E${padded(identity.episodeNumber)}`
          : null)
      : title?.status ?? null);

  return {
    mediaType: resolvedMediaType,
    kind: resolvedMediaType === 'episode' ? 'episode' : 'title',
    mediaKey: identity.mediaKey,
    parentMediaType: resolveProviderParentMediaType(identity),
    tmdbId: identity.tmdbId ?? null,
    showTmdbId: identity.showTmdbId ?? null,
    seasonNumber: identity.seasonNumber ?? null,
    episodeNumber: identity.episodeNumber ?? null,
    absoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? null,
    title: titleName,
    subtitle,
    summary: currentEpisode?.overview ?? title?.overview ?? null,
    overview: currentEpisode?.overview ?? title?.overview ?? null,
    artwork,
    images,
    releaseDate,
    releaseYear: extractReleaseYear(releaseDate),
    runtimeMinutes: deriveRuntimeMinutes(title, currentEpisode),
    rating: extractRating(title, currentEpisode),
    status: title?.status ?? null,
  };
}
