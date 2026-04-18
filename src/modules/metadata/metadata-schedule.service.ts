import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

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
    private readonly titleSourceService = new MetadataTitleSourceService(),
  ) {}

  async getScheduleInfo(client: DbClient, identity: MediaIdentity): Promise<ScheduleInfo> {
    const source = await this.titleSourceService.loadTitleSource(client, identity);
    if (!source.tmdbNextEpisode) {
      return { nextEpisodeAirDate: null, nextEpisode: null };
    }

    return {
      nextEpisodeAirDate: source.tmdbNextEpisode.airDate ?? null,
      nextEpisode: source.tmdbNextEpisode
        ? {
            seasonNumber: source.tmdbNextEpisode.seasonNumber ?? 0,
            episodeNumber: source.tmdbNextEpisode.episodeNumber ?? 0,
            title: source.tmdbNextEpisode.name,
            airDate: source.tmdbNextEpisode.airDate,
          }
        : null,
    };
  }

  async getNextEpisodeAirDate(client: DbClient, identity: MediaIdentity): Promise<string | null> {
    const info = await this.getScheduleInfo(client, identity);
    return info.nextEpisodeAirDate;
  }
}
