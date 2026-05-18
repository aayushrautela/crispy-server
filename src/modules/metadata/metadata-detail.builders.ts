import type { MediaIdentity } from '../identity/media-key.js';
import {
  buildEpisodePreview,
  buildMetadataCardView,
} from './metadata-card.builders.js';
import type { MetadataCardView } from './metadata-card.types.js';
import {
  buildMetadataImages,
  extractCertification,
  extractExternalIds,
  extractGenres,
  extractPrimaryTrailer,
  extractReleaseYear,
} from './metadata-builder.shared.js';
import {
  mediaItemToBaseItemDto,
  metadataCardToMediaItem,
} from './media-item.mapper.js';
import type { BaseItemDto } from './media-item.types.js';
import type {
  TmdbEpisodeRecord,
  TmdbTitleRecord,
} from './providers/tmdb.types.js';

export function buildDetailBaseItemDto(params: {
  identity: MediaIdentity;
  title: TmdbTitleRecord | null;
  currentEpisode?: TmdbEpisodeRecord | null;
  nextEpisode?: TmdbEpisodeRecord | null;
  language?: string | null;
}): BaseItemDto {
  const card = buildMetadataCardView(params);
  const mediaItem = metadataCardToMediaItem(card, {
    externalIds: extractExternalIds(params.title),
  });
  return mediaItemToBaseItemDto(mediaItem);
}

export function buildEpisodeBaseItemDto(
  title: TmdbTitleRecord,
  episode: TmdbEpisodeRecord,
  _contentId: string,
  _showId: string,
): BaseItemDto {
  const preview = buildEpisodePreview(title, episode);
  const images = buildMetadataImages(title, episode);
  const card: MetadataCardView = {
    mediaType: 'episode',
    kind: 'episode',
    mediaKey: preview.mediaKey,
    parentMediaType: 'show',
    tmdbId: preview.tmdbId,
    showTmdbId: preview.showTmdbId,
    seasonNumber: preview.seasonNumber,
    episodeNumber: preview.episodeNumber,
    absoluteEpisodeNumber: preview.absoluteEpisodeNumber,
    title: preview.title,
    subtitle: title.name ?? title.originalName,
    summary: preview.summary,
    overview: preview.summary,
    artwork: { poster: images.poster, backdrop: images.backdrop, still: images.still },
    images,
    releaseDate: preview.airDate,
    releaseYear: extractReleaseYear(preview.airDate),
    runtimeMinutes: preview.runtimeMinutes,
    rating: preview.rating,
    status: title.status,
    maturityRating: extractCertification(title),
    trailerUrl: extractPrimaryTrailer(title)?.url ?? null,
    trailerThumbnailUrl: extractPrimaryTrailer(title)?.thumbnailUrl ?? null,
    posterColor: null,
    backdropColor: null,
    genres: extractGenres(title),
  };

  const mediaItem = metadataCardToMediaItem(card, {
    externalIds: extractExternalIds(title),
    parent: {
      mediaKey: `show:tmdb:${title.tmdbId}`,
      mediaType: 'show',
      title: title.name ?? title.originalName ?? 'Untitled',
    },
  });
  return mediaItemToBaseItemDto(mediaItem);
}

export function buildSeasonBaseItemDto(
  title: TmdbTitleRecord,
  seasonNumber: number,
  seasonId: string,
): BaseItemDto {
  const rawSeasons = Array.isArray(title.raw.seasons) ? title.raw.seasons : [];
  const rawSeason = rawSeasons.find(
    (s) => typeof s === 'object' && s !== null && (s as Record<string, unknown>).season_number === seasonNumber,
  ) as Record<string, unknown> | undefined;

  const seasonName = rawSeason && typeof rawSeason.name === 'string' ? rawSeason.name : null;
  const seasonOverview = rawSeason && typeof rawSeason.overview === 'string' ? rawSeason.overview : null;
  const seasonPosterPath = rawSeason && typeof rawSeason.poster_path === 'string' ? rawSeason.poster_path : null;
  const seasonAirDate = rawSeason && typeof rawSeason.air_date === 'string' ? rawSeason.air_date : null;
  const images = buildMetadataImages({
    ...title,
    posterPath: seasonPosterPath ?? title.posterPath,
  }, null);

  const mediaKey = `season:tmdb:${title.tmdbId}:${seasonNumber}`;

  const card = {
    mediaType: 'season',
    kind: 'title',
    mediaKey,
    parentMediaType: 'show',
    tmdbId: title.tmdbId,
    showTmdbId: title.tmdbId,
    seasonNumber,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    title: seasonName ?? `Season ${seasonNumber}`,
    subtitle: null,
    summary: seasonOverview,
    overview: seasonOverview,
    artwork: { poster: images.poster, backdrop: images.backdrop, still: images.still },
    images,
    releaseDate: seasonAirDate,
    releaseYear: extractReleaseYear(seasonAirDate),
    runtimeMinutes: null,
    rating: null,
    status: null,
    maturityRating: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    genres: [],
  } as unknown as MetadataCardView;

  const mediaItem = metadataCardToMediaItem(card, {
    parent: {
      mediaKey: `show:tmdb:${title.tmdbId}`,
      mediaType: 'show',
      title: title.name ?? title.originalName ?? 'Untitled',
    },
  });
  const dto = mediaItemToBaseItemDto(mediaItem);

  return {
    ...dto,
    SeasonId: seasonId,
    SeasonName: seasonName ?? `Season ${seasonNumber}`,
  };
}
