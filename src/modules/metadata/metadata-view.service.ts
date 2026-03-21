import type { DbClient } from '../../lib/db.js';
import { env } from '../../config/env.js';
import type { MediaIdentity } from '../watch/media-key.js';
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
      if (title?.numberOfSeasons) {
        for (let season = 1; season <= title.numberOfSeasons; season += 1) {
          await this.tmdbCacheService.refreshSeason(client, identity.showTmdbId, season);
        }
      }

      const episodes = await this.tmdbCacheService.listEpisodesForShow(client, identity.showTmdbId);
      if (identity.seasonNumber !== null && identity.episodeNumber !== null) {
        currentEpisode = episodes.find(
          (episode) => episode.seasonNumber === identity.seasonNumber && episode.episodeNumber === identity.episodeNumber,
        ) ?? null;
      }
      if (identity.mediaType === 'episode') {
        nextEpisode = episodes.find((episode) => {
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
