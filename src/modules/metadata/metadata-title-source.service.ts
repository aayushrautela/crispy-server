import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { showTmdbIdForIdentity } from '../identity/media-key.js';
import type { MetadataTitleSourceSnapshot } from './metadata-title-source.types.js';
import { extractNextEpisodeToAir } from './providers/tmdb-episode-helpers.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { TmdbEpisodeRecord, TmdbTitleRecord, TmdbTitleType } from './providers/tmdb.types.js';

export class MetadataTitleSourceService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async loadTitleSource(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleSourceSnapshot> {
    const normalizedLanguage = language ?? null;

    const titleType: TmdbTitleType = identity.mediaType === 'movie' ? 'movie' : 'tv';
    const titleTmdbId = identity.mediaType === 'episode' ? showTmdbIdForIdentity(identity) : identity.tmdbId;
    const tmdbTitle = titleTmdbId ? await this.tmdbCacheService.getTitle(client, titleType, titleTmdbId, normalizedLanguage) : null;
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

  async loadTitleSources(client: DbClient, identities: MediaIdentity[], language?: string | null): Promise<Map<string, MetadataTitleSourceSnapshot>> {
    const normalizedLanguage = language ?? null;

    const titleRequests: Array<{ mediaType: TmdbTitleType; tmdbId: number }> = [];
    const titleRequestSeen = new Set<string>();
    const episodeRequests: Array<{ showTmdbId: number; seasonNumber: number; episodeNumber: number }> = [];

    for (const identity of identities) {
      const titleType: TmdbTitleType = identity.mediaType === 'movie' ? 'movie' : 'tv';
      const titleTmdbId = identity.mediaType === 'episode' ? showTmdbIdForIdentity(identity) : identity.tmdbId;
      if (titleTmdbId && !titleRequestSeen.has(`${titleType}:${titleTmdbId}`)) {
        titleRequestSeen.add(`${titleType}:${titleTmdbId}`);
        titleRequests.push({ mediaType: titleType, tmdbId: titleTmdbId });
      }
      if (identity.mediaType === 'episode' && titleTmdbId && identity.seasonNumber !== null && identity.episodeNumber !== null) {
        episodeRequests.push({ showTmdbId: titleTmdbId, seasonNumber: identity.seasonNumber, episodeNumber: identity.episodeNumber });
      }
    }

    const [titles, episodes] = await Promise.all([
      titleRequests.length
        ? this.tmdbCacheService.getTitles(client, titleRequests, normalizedLanguage)
        : Promise.resolve(new Map<string, TmdbTitleRecord | null>()),
      episodeRequests.length
        ? this.tmdbCacheService.getEpisodes(client, episodeRequests)
        : Promise.resolve(new Map<string, TmdbEpisodeRecord | null>()),
    ]);

    const result = new Map<string, MetadataTitleSourceSnapshot>();
    for (const identity of identities) {
      const titleType: TmdbTitleType = identity.mediaType === 'movie' ? 'movie' : 'tv';
      const titleTmdbId = identity.mediaType === 'episode' ? showTmdbIdForIdentity(identity) : identity.tmdbId;
      const tmdbTitle = titleTmdbId ? (titles.get(`${titleType}:${titleTmdbId}`) ?? null) : null;
      const tmdbCurrentEpisode = identity.mediaType === 'episode' && titleTmdbId && identity.seasonNumber !== null && identity.episodeNumber !== null
        ? (episodes.get(`${titleTmdbId}:${identity.seasonNumber}:${identity.episodeNumber}`) ?? null)
        : null;
      const tmdbNextEpisode = tmdbTitle && tmdbTitle.mediaType === 'tv' ? extractNextEpisodeToAir(tmdbTitle) : null;

      result.set(identity.mediaKey, {
        identity,
        language: normalizedLanguage,
        tmdbTitle,
        tmdbCurrentEpisode,
        tmdbNextEpisode,
      });
    }
    return result;
  }
}
