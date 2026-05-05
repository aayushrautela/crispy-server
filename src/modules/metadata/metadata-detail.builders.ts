import type { MediaIdentity } from '../identity/media-key.js';
import {
  buildMetadataCardView,
  buildEpisodePreview,
} from './metadata-card.builders.js';
import type {
  MetadataEpisodeView,
  MetadataSeasonView,
  MetadataView,
} from './metadata-detail.types.js';
import {
  buildMetadataImages,
  deriveRuntimeMinutes,
  extractCertification,
  extractExternalIds,
  extractGenres,
  extractReleaseYear,
} from './metadata-builder.shared.js';
import type {
  TmdbEpisodeRecord,
  TmdbSeasonRecord,
  TmdbTitleRecord,
} from './providers/tmdb.types.js';

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
    nextEpisode: title && params.nextEpisode
      ? buildEpisodePreview(title, params.nextEpisode)
      : null,
  };
}

export function buildSeasonViewFromTitleRaw(
  title: TmdbTitleRecord,
  seasonIds: Map<number, string>,
): MetadataSeasonView[] {
  const seasons = Array.isArray(title.raw.seasons) ? title.raw.seasons : [];

  const items: MetadataSeasonView[] = [];
  for (const entry of seasons) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const season = entry as Record<string, unknown>;
    const seasonNumber = typeof season.season_number === 'number' ? season.season_number : null;
    if (seasonNumber === null || seasonNumber < 0 || !seasonIds.get(seasonNumber)) {
      continue;
    }

    items.push({
      mediaKey: `season:tmdb:${title.tmdbId}:${seasonNumber}`,
      parentMediaType: 'show',
      showTmdbId: title.tmdbId,
      seasonNumber,
      title: typeof season.name === 'string' ? season.name : null,
      summary: typeof season.overview === 'string' ? season.overview : null,
      airDate: typeof season.air_date === 'string' ? season.air_date : null,
      episodeCount: typeof season.episode_count === 'number' ? season.episode_count : null,
      images: {
        posterUrl: buildMetadataImages({
          ...title,
          posterPath: typeof season.poster_path === 'string' ? season.poster_path : null,
        }, null).posterUrl,
      },
    });
  }

  return items.sort((left, right) => left.seasonNumber - right.seasonNumber);
}

export function buildSeasonViewFromRecord(
  showTmdbId: number,
  season: TmdbSeasonRecord,
  _seasonId: string,
  _showId: string,
): MetadataSeasonView {
  return {
    mediaKey: `season:tmdb:${showTmdbId}:${season.seasonNumber}`,
    parentMediaType: 'show',
    showTmdbId,
    seasonNumber: season.seasonNumber,
    title: season.name,
    summary: season.overview,
    airDate: season.airDate,
    episodeCount: season.episodeCount,
    images: {
      posterUrl: buildMetadataImages({
        mediaType: 'tv',
        tmdbId: showTmdbId,
        name: null,
        originalName: null,
        overview: null,
        releaseDate: null,
        firstAirDate: null,
        status: null,
        posterPath: season.posterPath,
        backdropPath: null,
        runtime: null,
        episodeRunTime: [],
        numberOfSeasons: null,
        numberOfEpisodes: null,
        externalIds: {},
        raw: {},
        fetchedAt: season.fetchedAt,
        expiresAt: season.expiresAt,
      }, null).posterUrl,
    },
  };
}

export function buildEpisodeView(
  title: TmdbTitleRecord,
  episode: TmdbEpisodeRecord,
  _contentId: string,
  _showId: string,
): MetadataEpisodeView {
  return {
    ...buildEpisodePreview(title, episode),
    showTitle: title.name ?? title.originalName,
    showExternalIds: extractExternalIds(title),
  };
}
