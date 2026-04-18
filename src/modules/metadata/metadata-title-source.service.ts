import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { showTmdbIdForIdentity } from '../identity/media-key.js';
import type { MetadataTitleSourceSnapshot } from './metadata-title-source.types.js';
import { extractNextEpisodeToAir } from './providers/tmdb-episode-helpers.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';

export class MetadataTitleSourceService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async loadTitleSource(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleSourceSnapshot> {
    const normalizedLanguage = language ?? null;

    const titleType = identity.mediaType === 'movie' ? 'movie' : 'tv';
    const titleTmdbId = identity.mediaType === 'episode' ? showTmdbIdForIdentity(identity) : identity.tmdbId;
    const tmdbTitle = titleTmdbId ? await this.tmdbCacheService.getTitle(client, titleType, titleTmdbId) : null;
    const tmdbCurrentEpisode = titleTmdbId
      && identity.mediaType === 'episode'
      && identity.seasonNumber !== null
      && identity.episodeNumber !== null
      ? await this.tmdbCacheService.getEpisode(client, titleTmdbId, identity.seasonNumber, identity.episodeNumber)
      : null;

    return {
      identity,
      language: normalizedLanguage,
      tmdbTitle,
      tmdbCurrentEpisode,
      tmdbNextEpisode: identity.mediaType !== 'movie' && tmdbTitle?.mediaType === 'tv'
        ? extractNextEpisodeToAir(tmdbTitle)
        : null,
    };
  }
}
