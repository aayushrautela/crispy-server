import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import type { MediaIdentity } from '../watch/media-key.js';
import type {
  MetadataCardView,
  MetadataEpisodePreview,
  MetadataEpisodeView,
  MetadataExternalIds,
  MetadataImages,
  MetadataSeasonView,
  MetadataView,
  TmdbEpisodeRecord,
  TmdbSeasonRecord,
  TmdbTitleRecord,
} from './tmdb.types.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function padded(value: number): string {
  return String(value).padStart(2, '0');
}

export function buildImageUrl(path: string | null, size: string): string | null {
  if (!path) {
    return null;
  }

  return `${env.tmdbImageBaseUrl.replace(/\/$/, '')}/${size}${path}`;
}

export function buildMetadataId(identity: {
  mediaType: 'movie' | 'show' | 'episode';
  tmdbId?: number | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): string {
  if (identity.mediaType === 'movie' && identity.tmdbId) {
    return `crisp:movie:${identity.tmdbId}`;
  }

  if (identity.mediaType === 'show' && identity.tmdbId) {
    return `crisp:show:${identity.tmdbId}`;
  }

  if (
    identity.mediaType === 'episode' &&
    identity.showTmdbId &&
    identity.seasonNumber !== null &&
    identity.seasonNumber !== undefined &&
    identity.episodeNumber !== null &&
    identity.episodeNumber !== undefined
  ) {
    return `crisp:episode:${identity.showTmdbId}:${identity.seasonNumber}:${identity.episodeNumber}`;
  }

  throw new HttpError(400, 'Unable to build metadata id.');
}

export function parseMetadataId(id: string): MediaIdentity {
  const normalized = id.trim();
  const parts = normalized.split(':');
  if (parts.length < 3 || parts[0] !== 'crisp') {
    throw new HttpError(400, 'Invalid metadata id.');
  }

  const mediaType = parts[1];
  if ((mediaType === 'movie' || mediaType === 'show') && parts.length === 3) {
    const tmdbId = Number(parts[2]);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      throw new HttpError(400, 'Invalid metadata id.');
    }
    return {
      mediaKey: `${mediaType}:tmdb:${tmdbId}`,
      mediaType,
      tmdbId,
      showTmdbId: mediaType === 'show' ? tmdbId : null,
      seasonNumber: null,
      episodeNumber: null,
    };
  }

  if (mediaType === 'episode' && parts.length === 5) {
    const showTmdbId = Number(parts[2]);
    const seasonNumber = Number(parts[3]);
    const episodeNumber = Number(parts[4]);
    if (
      !Number.isInteger(showTmdbId) ||
      showTmdbId <= 0 ||
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 0 ||
      !Number.isInteger(episodeNumber) ||
      episodeNumber <= 0
    ) {
      throw new HttpError(400, 'Invalid metadata id.');
    }

    return {
      mediaKey: `episode:tmdb:${showTmdbId}:${seasonNumber}:${episodeNumber}`,
      mediaType: 'episode',
      tmdbId: null,
      showTmdbId,
      seasonNumber,
      episodeNumber,
    };
  }

  throw new HttpError(400, 'Invalid metadata id.');
}

export function metadataMediaTypeFromTitle(title: TmdbTitleRecord): 'movie' | 'show' {
  return title.mediaType === 'movie' ? 'movie' : 'show';
}

export function deriveRuntimeMinutes(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): number | null {
  if (episode?.runtime) {
    return episode.runtime;
  }
  if (title?.runtime) {
    return title.runtime;
  }
  if (title?.episodeRunTime.length) {
    return title.episodeRunTime[0] ?? null;
  }
  return null;
}

export function extractReleaseDate(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): string | null {
  return episode?.airDate ?? title?.releaseDate ?? title?.firstAirDate ?? null;
}

export function extractReleaseYear(date: string | null): number | null {
  if (!date) {
    return null;
  }

  const year = Number(date.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

export function extractGenres(title: TmdbTitleRecord | null): string[] {
  const raw = title?.raw;
  if (!raw) {
    return [];
  }

  return asArray(raw.genres)
    .map((genre) => asString(asRecord(genre)?.name))
    .filter((value): value is string => value !== null);
}

function extractBestLogoPath(raw: Record<string, unknown>): string | null {
  const images = asRecord(raw.images);
  const logos = asArray(images?.logos)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const preferred = logos.find((logo) => asString(logo.iso_639_1) === 'en')
    ?? logos.find((logo) => asString(logo.iso_639_1) === null)
    ?? logos[0]
    ?? null;

  return preferred ? asString(preferred.file_path) : null;
}

export function extractRating(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): number | null {
  if (episode?.voteAverage !== null && episode?.voteAverage !== undefined) {
    return episode.voteAverage;
  }

  const raw = title?.raw;
  return raw ? asNumber(raw.vote_average) : null;
}

function extractMovieCertification(raw: Record<string, unknown>): string | null {
  const releaseDates = asArray(asRecord(raw.release_dates)?.results)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const preferredRegion = releaseDates.find((entry) => asString(entry.iso_3166_1) === 'US') ?? releaseDates[0] ?? null;
  if (!preferredRegion) {
    return null;
  }

  const certifications = asArray(preferredRegion.release_dates)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => asString(entry.certification))
    .filter((value): value is string => value !== null);

  return certifications[0] ?? null;
}

function extractShowCertification(raw: Record<string, unknown>): string | null {
  const ratings = asArray(asRecord(raw.content_ratings)?.results)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const preferredRegion = ratings.find((entry) => asString(entry.iso_3166_1) === 'US') ?? ratings[0] ?? null;
  return preferredRegion ? asString(preferredRegion.rating) : null;
}

export function extractCertification(title: TmdbTitleRecord | null): string | null {
  if (!title) {
    return null;
  }

  if (title.mediaType === 'movie') {
    return extractMovieCertification(title.raw);
  }

  return extractShowCertification(title.raw);
}

export function extractExternalIds(title: TmdbTitleRecord | null): MetadataExternalIds {
  const externalIds = title?.externalIds ?? {};
  const imdb = asString(externalIds.imdb_id);
  const tvdb = asNumber(externalIds.tvdb_id);

  return {
    tmdb: title?.tmdbId ?? null,
    imdb,
    tvdb,
  };
}

export function buildMetadataImages(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): MetadataImages {
  return {
    posterUrl: buildImageUrl(title?.posterPath ?? null, 'w500'),
    backdropUrl: buildImageUrl(title?.backdropPath ?? null, 'w780'),
    stillUrl: buildImageUrl(episode?.stillPath ?? null, 'w500'),
    logoUrl: title ? buildImageUrl(extractBestLogoPath(title.raw), 'w500') : null,
  };
}

export function buildEpisodePreview(title: TmdbTitleRecord, episode: TmdbEpisodeRecord): MetadataEpisodePreview {
  const images = buildMetadataImages(title, episode);

  return {
    id: buildMetadataId({
      mediaType: 'episode',
      showTmdbId: episode.showTmdbId,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
    }),
    mediaType: 'episode',
    tmdbId: episode.tmdbId,
    showTmdbId: episode.showTmdbId,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    title: episode.name,
    summary: episode.overview,
    airDate: episode.airDate,
    runtimeMinutes: episode.runtime,
    rating: episode.voteAverage,
    images,
  };
}

export function buildMetadataCardView(params: {
  identity: MediaIdentity;
  title: TmdbTitleRecord | null;
  currentEpisode?: TmdbEpisodeRecord | null;
  titleOverride?: string | null;
  subtitleOverride?: string | null;
  summaryOverride?: string | null;
  overviewOverride?: string | null;
  posterUrlOverride?: string | null;
  backdropUrlOverride?: string | null;
}): MetadataCardView {
  const { identity, title } = params;
  const currentEpisode = params.currentEpisode ?? null;
  const releaseDate = extractReleaseDate(title, currentEpisode);
  const images = buildMetadataImages(title, currentEpisode);
  const resolvedMediaType = identity.mediaType === 'show' || identity.mediaType === 'episode' ? identity.mediaType : 'movie';
  const titleName = params.titleOverride ?? (
    resolvedMediaType === 'episode'
      ? title?.name ?? title?.originalName ?? currentEpisode?.name ?? null
      : currentEpisode?.name ?? title?.name ?? title?.originalName ?? null
  );
  const subtitle = params.subtitleOverride ?? (
    resolvedMediaType === 'episode'
      ? currentEpisode?.name ?? (
        identity.seasonNumber !== null && identity.episodeNumber !== null
          ? `S${padded(identity.seasonNumber)} E${padded(identity.episodeNumber)}`
          : null
      )
      : title?.status ?? null
  );
  const posterUrl = params.posterUrlOverride ?? images.posterUrl;
  const backdropUrl = params.backdropUrlOverride ?? images.backdropUrl;

  return {
    id: buildMetadataId({
      mediaType: resolvedMediaType,
      tmdbId: resolvedMediaType === 'movie' || resolvedMediaType === 'show' ? identity.tmdbId : null,
      showTmdbId: identity.showTmdbId,
      seasonNumber: identity.seasonNumber,
      episodeNumber: identity.episodeNumber,
    }),
    mediaKey: identity.mediaKey,
    mediaType: resolvedMediaType,
    kind: resolvedMediaType === 'episode' ? 'episode' : 'title',
    tmdbId: identity.tmdbId,
    showTmdbId: identity.showTmdbId,
    seasonNumber: identity.seasonNumber,
    episodeNumber: identity.episodeNumber,
    title: titleName,
    subtitle,
    summary: params.summaryOverride ?? currentEpisode?.overview ?? title?.overview ?? null,
    overview: params.overviewOverride ?? currentEpisode?.overview ?? title?.overview ?? null,
    artwork: {
      posterUrl,
      backdropUrl,
      stillUrl: images.stillUrl,
    },
    images: {
      ...images,
      posterUrl,
      backdropUrl,
    },
    releaseDate,
    releaseYear: extractReleaseYear(releaseDate),
    runtimeMinutes: deriveRuntimeMinutes(title, currentEpisode),
    rating: extractRating(title, currentEpisode),
    status: title?.status ?? null,
  };
}

export function buildMetadataView(params: {
  identity: MediaIdentity;
  title: TmdbTitleRecord | null;
  currentEpisode?: TmdbEpisodeRecord | null;
  nextEpisode?: TmdbEpisodeRecord | null;
}): MetadataView {
  const card = buildMetadataCardView(params);
  const { identity, title } = params;
  const currentEpisode = params.currentEpisode ?? null;

  return {
    ...card,
    runtimeMinutes: deriveRuntimeMinutes(title, currentEpisode),
    certification: extractCertification(title),
    genres: extractGenres(title),
    externalIds: extractExternalIds(title),
    seasonCount: title?.numberOfSeasons ?? null,
    episodeCount: title?.numberOfEpisodes ?? null,
    nextEpisode: title && params.nextEpisode ? buildEpisodePreview(title, params.nextEpisode) : null,
  };
}

export function buildSeasonViewFromTitleRaw(title: TmdbTitleRecord): MetadataSeasonView[] {
  const seasons = asArray(title.raw.seasons)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((season) => {
      const seasonNumber = asNumber(season.season_number);
      if (seasonNumber === null || seasonNumber < 0) {
        return null;
      }

      return {
        id: `crisp:season:${title.tmdbId}:${seasonNumber}`,
        showId: buildMetadataId({ mediaType: 'show', tmdbId: title.tmdbId }),
        showTmdbId: title.tmdbId,
        seasonNumber,
        title: asString(season.name),
        summary: asString(season.overview),
        airDate: asString(season.air_date),
        episodeCount: asNumber(season.episode_count),
        images: {
          posterUrl: buildImageUrl(asString(season.poster_path), 'w500'),
        },
      } satisfies MetadataSeasonView;
    })
    .filter((season): season is MetadataSeasonView => season !== null)
    .sort((left, right) => left.seasonNumber - right.seasonNumber);

  return seasons;
}

export function buildSeasonViewFromRecord(showTmdbId: number, season: TmdbSeasonRecord): MetadataSeasonView {
  return {
    id: `crisp:season:${showTmdbId}:${season.seasonNumber}`,
    showId: buildMetadataId({ mediaType: 'show', tmdbId: showTmdbId }),
    showTmdbId,
    seasonNumber: season.seasonNumber,
    title: season.name,
    summary: season.overview,
    airDate: season.airDate,
    episodeCount: season.episodeCount,
    images: {
      posterUrl: buildImageUrl(season.posterPath, 'w500'),
    },
  };
}

export function buildEpisodeView(title: TmdbTitleRecord, episode: TmdbEpisodeRecord): MetadataEpisodeView {
  return {
    ...buildEpisodePreview(title, episode),
    showId: buildMetadataId({ mediaType: 'show', tmdbId: title.tmdbId }),
    showTitle: title.name ?? title.originalName,
    showExternalIds: extractExternalIds(title),
  };
}
