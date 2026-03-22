import type { DbClient } from '../../lib/db.js';
import { env } from '../../config/env.js';
import type { MediaIdentity } from '../watch/media-key.js';
import { extractNextEpisodeToAir } from './tmdb-episode-helpers.js';
import { TmdbCacheService } from './tmdb-cache.service.js';
import type { MetadataView, TmdbEpisodeRecord, TmdbTitleRecord } from './tmdb.types.js';

function buildImageUrl(path: string | null, size: string): string | null {
  if (!path) {
    return null;
  }
  return `${env.tmdbImageBaseUrl.replace(/\/$/, '')}/${size}${path}`;
}

function deriveRuntimeMinutes(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): number | null {
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

export class MetadataViewService {
  constructor(private readonly tmdbCacheService = new TmdbCacheService()) {}

  async buildMetadataView(client: DbClient, identity: MediaIdentity): Promise<MetadataView> {
    const titleType = identity.mediaType === 'movie' ? 'movie' : 'tv';
    const titleTmdbId = identity.mediaType === 'episode' ? identity.showTmdbId : identity.tmdbId;
    const title = titleTmdbId ? await this.tmdbCacheService.getTitle(client, titleType, titleTmdbId) : null;

    let currentEpisode: TmdbEpisodeRecord | null = null;
    let nextEpisode: TmdbEpisodeRecord | null = null;

    if (identity.showTmdbId) {
      const seasonsToEnsure = collectRelevantSeasonNumbers(identity, title);
      for (const seasonNumber of seasonsToEnsure) {
        await this.tmdbCacheService.ensureSeasonCached(client, identity.showTmdbId, seasonNumber);
      }

      const episodes = await this.tmdbCacheService.listEpisodesForShow(client, identity.showTmdbId);
      if (identity.seasonNumber !== null && identity.episodeNumber !== null) {
        currentEpisode = episodes.find(
          (episode) => episode.seasonNumber === identity.seasonNumber && episode.episodeNumber === identity.episodeNumber,
        ) ?? null;
      }
      if (identity.mediaType === 'episode') {
        nextEpisode = selectNextEpisode(identity, title, episodes);
      }
    }

    const titleName = currentEpisode?.name ?? title?.name ?? title?.originalName ?? null;
    const subtitle =
      identity.mediaType === 'episode' && identity.seasonNumber !== null && identity.episodeNumber !== null
        ? `S${String(identity.seasonNumber).padStart(2, '0')} E${String(identity.episodeNumber).padStart(2, '0')}`
        : title?.status ?? null;

    return {
      mediaKey: identity.mediaKey,
      mediaType: identity.mediaType,
      tmdbId: identity.tmdbId,
      showTmdbId: identity.showTmdbId,
      seasonNumber: identity.seasonNumber,
      episodeNumber: identity.episodeNumber,
      title: titleName,
      subtitle,
      overview: currentEpisode?.overview ?? title?.overview ?? null,
      artwork: {
        posterUrl: buildImageUrl(title?.posterPath ?? null, 'w500'),
        backdropUrl: buildImageUrl(title?.backdropPath ?? null, 'w780'),
        stillUrl: buildImageUrl(currentEpisode?.stillPath ?? null, 'w500'),
      },
      releaseDate: currentEpisode?.airDate ?? title?.releaseDate ?? title?.firstAirDate ?? null,
      runtimeMinutes: deriveRuntimeMinutes(title, currentEpisode),
      nextEpisode,
    };
  }
}

function collectRelevantSeasonNumbers(identity: MediaIdentity, title: TmdbTitleRecord | null): number[] {
  const seasons = new Set<number>();

  if (identity.seasonNumber && identity.seasonNumber > 0) {
    seasons.add(identity.seasonNumber);
  }

  const nextEpisode = extractNextEpisodeToAir(title);
  if (nextEpisode?.seasonNumber) {
    seasons.add(nextEpisode.seasonNumber);
  }

  if (seasons.size === 0 && title?.numberOfSeasons && title.numberOfSeasons > 0) {
    seasons.add(title.numberOfSeasons);
  }

  return Array.from(seasons).sort((left, right) => left - right);
}

function selectNextEpisode(
  identity: MediaIdentity,
  title: TmdbTitleRecord | null,
  episodes: TmdbEpisodeRecord[],
): TmdbEpisodeRecord | null {
  const tmdbNextEpisode = extractNextEpisodeToAir(title);
  if (tmdbNextEpisode) {
    return tmdbNextEpisode;
  }

  return episodes.find((episode) => {
    if (!episode.airDate || Date.parse(episode.airDate) > Date.now()) {
      return false;
    }
    if (episode.seasonNumber < (identity.seasonNumber ?? 0)) {
      return false;
    }
    if (episode.seasonNumber === identity.seasonNumber && episode.episodeNumber <= (identity.episodeNumber ?? 0)) {
      return false;
    }
    return true;
  }) ?? null;
}
