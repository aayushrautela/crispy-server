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
import type { TmdbEpisodeRecord, TmdbSeasonRecord, TmdbTitleRecord } from './providers/tmdb.types.js';
import {
  buildMetadataImages,
  deriveRuntimeMinutes,
  extractGenres,
  extractRating,
  extractReleaseDate,
  extractReleaseYear,
  extractCertification,
  extractExternalIds,
  extractPrimaryTrailer,
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
  const poster = card.images.poster;
  if (!card.title || (!poster.small && !poster.medium && !poster.large)) {
    return null;
  }

  return {
    mediaType: card.mediaType,
    itemId: card.itemId,
    title: card.title,
    poster,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genre: null,
    subtitle: card.subtitle,
  };
}

export function buildEpisodePreview(params: {
  title: TmdbTitleRecord;
  episode: TmdbEpisodeRecord;
  itemId: string;
  language?: string | null;
}): MetadataEpisodePreview {
  const { title, episode, itemId, language } = params;
  return {
    mediaType: 'episode',
    itemId,
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
    images: buildMetadataImages(title, episode, language),
    externalIds: title ? extractExternalIds(title) : { tmdb: episode.tmdbId ?? null, imdb: null, tvdb: null },
  };
}

export function buildMetadataCardView(params: {
  identity: MediaIdentity;
  itemId?: string;
  seriesItemId?: string | null;
  seasonItemId?: string | null;
  title: TmdbTitleRecord | null;
  currentEpisode?: TmdbEpisodeRecord | null;
  currentSeason?: TmdbSeasonRecord | null;
  titleOverride?: string | null;
  subtitleOverride?: string | null;
  language?: string | null;
}): MetadataCardView {
  const { identity, title, currentEpisode = null, currentSeason = null, language } = params;
  const releaseDate = currentEpisode?.airDate ?? currentSeason?.airDate ?? extractReleaseDate(title, currentEpisode);
  const images = buildMetadataImages(title, currentEpisode, language, currentSeason?.posterPath ?? null);
  const trailer = extractPrimaryTrailer(title, language);
  const artwork = {
    poster: images.poster,
    backdrop: images.backdrop,
    still: images.still,
  };
  const resolvedMediaType = identity.mediaType === 'show' || identity.mediaType === 'episode' || identity.mediaType === 'season'
    ? identity.mediaType
    : 'movie';
  const isChildCard = identity.mediaType === 'episode' || identity.mediaType === 'season';
  const showTitle = isChildCard ? (title?.name ?? title?.originalName ?? null) : null;
  const titleName = params.titleOverride
    ?? (currentEpisode?.name ?? currentSeason?.name ?? title?.name ?? title?.originalName ?? null);
  const subtitle = params.subtitleOverride
    ?? (resolvedMediaType === 'episode'
      ? title?.name ?? title?.originalName
        ?? (identity.seasonNumber !== null && identity.episodeNumber !== null
          ? `S${padded(identity.seasonNumber)} E${padded(identity.episodeNumber)}`
          : null)
      : resolvedMediaType === 'season'
        ? title?.name ?? title?.originalName ?? null
        : title?.status ?? null);

  return {
    mediaType: resolvedMediaType,
    kind: resolvedMediaType === 'episode' ? 'episode' : 'title',
    itemId: params.itemId ?? '',
    parentMediaType: resolveProviderParentMediaType(identity),
    seriesItemId: params.seriesItemId ?? null,
    seasonItemId: params.seasonItemId ?? null,
    seriesTitle: showTitle,
    tmdbId: identity.tmdbId ?? null,
    showTmdbId: identity.showTmdbId ?? null,
    seasonNumber: identity.seasonNumber ?? null,
    episodeNumber: identity.episodeNumber ?? null,
    absoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? null,
    title: titleName,
    subtitle,
    summary: currentEpisode?.overview ?? currentSeason?.overview ?? title?.overview ?? null,
    overview: currentEpisode?.overview ?? currentSeason?.overview ?? title?.overview ?? null,
    tagline: title?.tagline ?? (typeof title?.raw?.tagline === 'string' ? title.raw.tagline : null),
    artwork,
    images,
    releaseDate,
    releaseYear: extractReleaseYear(releaseDate),
    runtimeMinutes: deriveRuntimeMinutes(title, currentEpisode),
    rating: currentEpisode ? extractRating(title, currentEpisode) : extractRating(title, null),
    status: title?.status ?? null,
    maturityRating: extractCertification(title),
    trailerUrl: trailer?.url ?? null,
    trailerThumbnailUrl: trailer?.thumbnailUrl ?? null,
    posterColor: null,
    backdropColor: null,
    genres: extractGenres(title),
    externalIds: title ? extractExternalIds(title) : { tmdb: identity.tmdbId ?? null, imdb: null, tvdb: null },
  };
}
