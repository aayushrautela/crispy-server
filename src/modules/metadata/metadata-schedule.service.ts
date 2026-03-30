import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { showTmdbIdForIdentity } from '../identity/media-key.js';
import { extractNextEpisodeToAir } from './providers/tmdb-episode-helpers.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import { ProviderMetadataService } from './provider-metadata.service.js';

export type ScheduleInfo = {
  nextEpisodeAirDate: string | null;
  nextEpisode: {
    seasonNumber: number | null;
    episodeNumber: number | null;
    title: string | null;
    airDate: string | null;
  } | null;
};

export class MetadataScheduleService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async getScheduleInfo(client: DbClient, identity: MediaIdentity): Promise<ScheduleInfo> {
    if (identity.provider === 'tmdb') {
      const showTmdbId = showTmdbIdForIdentity(identity);
      if (!showTmdbId) {
        return { nextEpisodeAirDate: null, nextEpisode: null };
      }

      const title = await this.tmdbCacheService.getTitle(client, 'tv', showTmdbId);
      const nextEpisode = extractNextEpisodeToAir(title);
      
      return {
        nextEpisodeAirDate: nextEpisode?.airDate ?? null,
        nextEpisode: nextEpisode
          ? {
              seasonNumber: nextEpisode.seasonNumber ?? 0,
              episodeNumber: nextEpisode.episodeNumber ?? 0,
              title: nextEpisode.name,
              airDate: nextEpisode.airDate,
            }
          : null,
      };
    }

    const context = await this.providerMetadataService.loadIdentityContext(client, identity);
    if (!context?.nextEpisode) {
      return { nextEpisodeAirDate: null, nextEpisode: null };
    }

    return {
      nextEpisodeAirDate: context.nextEpisode.airDate,
      nextEpisode: {
        seasonNumber: context.nextEpisode.seasonNumber,
        episodeNumber: context.nextEpisode.episodeNumber,
        title: context.nextEpisode.title,
        airDate: context.nextEpisode.airDate,
      },
    };
  }

  async getNextEpisodeAirDate(client: DbClient, identity: MediaIdentity): Promise<string | null> {
    const info = await this.getScheduleInfo(client, identity);
    return info.nextEpisodeAirDate;
  }
}