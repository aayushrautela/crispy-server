import {
  buildEpisodeProviderId,
  parentMediaTypeForIdentity,
  type MediaIdentity,
} from '../identity/media-key.js';
import type { MetadataParentMediaType } from './metadata-card.types.js';
import type {
  CatalogItem,
  MetadataCardView,
  MetadataEpisodePreview,
  ProviderEpisodeRecord,
  ProviderSeasonRecord,
  ProviderTitleRecord,
} from './metadata-card.types.js';
import type { TmdbEpisodeRecord, TmdbTitleRecord } from './providers/tmdb.types.js';
import {
  buildMetadataImages,
  buildProviderMetadataImages,
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

  return parentMediaTypeForIdentity(identity) === 'anime' ? 'anime' : 'show';
}

function buildProviderEpisodeSubtitle(episode: ProviderEpisodeRecord | null): string | null {
  if (!episode) {
    return null;
  }

  if (episode.title?.trim()) {
    return episode.title;
  }

  if (episode.seasonNumber !== null && episode.episodeNumber !== null) {
    return `S${padded(episode.seasonNumber)} E${padded(episode.episodeNumber)}`;
  }

  if (episode.absoluteEpisodeNumber !== null) {
    return `Episode ${episode.absoluteEpisodeNumber}`;
  }

  return null;
}

export function toCatalogItem(card: MetadataCardView): CatalogItem | null {
  const posterUrl = card.images.posterUrl ?? card.artwork.posterUrl;
  if (!card.title || !posterUrl) {
    return null;
  }

  return {
    mediaType: card.mediaType,
    mediaKey: card.mediaKey,
    provider: card.provider,
    providerId: card.providerId,
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
    provider: 'tmdb',
    providerId: buildEpisodeProviderId(String(episode.showTmdbId), episode.seasonNumber, episode.episodeNumber),
    parentMediaType: 'show',
    parentProvider: 'tmdb',
    parentProviderId: String(episode.showTmdbId),
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

export function buildProviderEpisodePreview(title: ProviderTitleRecord, episode: ProviderEpisodeRecord): MetadataEpisodePreview {
  return {
    mediaType: 'episode',
    mediaKey: `episode:${episode.provider}:${episode.parentProviderId}:${episode.seasonNumber ?? 1}:${episode.episodeNumber ?? episode.absoluteEpisodeNumber ?? 1}`,
    provider: episode.provider,
    providerId: episode.providerId,
    parentMediaType: episode.parentMediaType,
    parentProvider: episode.parentProvider,
    parentProviderId: episode.parentProviderId,
    tmdbId: title.externalIds.tmdb,
    showTmdbId: title.externalIds.tmdb,
    seasonNumber: episode.seasonNumber ?? 1,
    episodeNumber: episode.episodeNumber ?? episode.absoluteEpisodeNumber ?? 1,
    absoluteEpisodeNumber: episode.absoluteEpisodeNumber ?? null,
    title: episode.title,
    summary: episode.summary,
    airDate: episode.airDate,
    runtimeMinutes: episode.runtimeMinutes,
    rating: episode.rating,
    images: buildProviderMetadataImages(title, episode),
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
  const resolvedMediaType = identity.mediaType === 'show' || identity.mediaType === 'episode' || identity.mediaType === 'anime'
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
    provider: identity.provider ?? 'tmdb',
    providerId: identity.providerId ?? String(identity.tmdbId ?? identity.showTmdbId ?? ''),
    parentMediaType: resolveProviderParentMediaType(identity),
    parentProvider: identity.parentProvider ?? null,
    parentProviderId: identity.parentProviderId ?? null,
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

export function buildProviderMetadataCardView(params: {
  identity: MediaIdentity;
  title: ProviderTitleRecord;
  currentEpisode?: ProviderEpisodeRecord | null;
}): MetadataCardView {
  const { identity, title, currentEpisode = null } = params;
  const images = buildProviderMetadataImages(title, currentEpisode);
  const releaseDate = currentEpisode?.airDate ?? title.releaseDate;
  const resolvedMediaType = identity.mediaType === 'episode'
    ? 'episode'
    : identity.mediaType === 'anime'
      ? 'anime'
      : identity.mediaType === 'show'
        ? 'show'
        : 'movie';
  return {
    mediaType: resolvedMediaType,
    kind: resolvedMediaType === 'episode' ? 'episode' : 'title',
    mediaKey: identity.mediaKey,
    provider: currentEpisode?.provider ?? title.provider,
    providerId: currentEpisode?.providerId ?? title.providerId,
    parentMediaType: resolveProviderParentMediaType(identity),
    parentProvider: identity.parentProvider ?? currentEpisode?.parentProvider ?? null,
    parentProviderId: identity.parentProviderId ?? currentEpisode?.parentProviderId ?? null,
    tmdbId: identity.tmdbId ?? null,
    showTmdbId: identity.showTmdbId ?? null,
    seasonNumber: identity.seasonNumber ?? null,
    episodeNumber: identity.episodeNumber ?? null,
    absoluteEpisodeNumber: (identity.absoluteEpisodeNumber ?? currentEpisode?.absoluteEpisodeNumber) ?? null,
    title: resolvedMediaType === 'episode' ? title.title : currentEpisode?.title ?? title.title,
    subtitle: resolvedMediaType === 'episode' ? buildProviderEpisodeSubtitle(currentEpisode) : title.status,
    summary: currentEpisode?.summary ?? title.summary,
    overview: currentEpisode?.summary ?? title.overview,
    artwork: {
      posterUrl: images.posterUrl,
      backdropUrl: images.backdropUrl,
      stillUrl: images.stillUrl,
    },
    images,
    releaseDate,
    releaseYear: extractReleaseYear(releaseDate),
    runtimeMinutes: currentEpisode?.runtimeMinutes ?? title.runtimeMinutes,
    rating: currentEpisode?.rating ?? title.rating,
    status: title.status,
  };
}
