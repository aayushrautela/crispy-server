import type { DbClient } from '../../lib/db.js';
import { parseMediaKey, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';
import { TmdbRefreshService, type MetadataRefreshSummary } from './providers/tmdb-refresh.service.js';

export type MetadataRefreshResult = {
  summary: MetadataRefreshSummary;
  mediaKeys: string[];
};

function emptySummary(): MetadataRefreshSummary {
  return {
    refreshedTitles: 0,
    refreshedSeasons: 0,
    refreshedTrackedShows: 0,
    skipped: 0,
    failures: 0,
  };
}

function emptyResult(): MetadataRefreshResult {
  return {
    summary: emptySummary(),
    mediaKeys: [],
  };
}

export class MetadataRefreshService {
  constructor(
    private readonly tmdbRefreshService = new TmdbRefreshService(),
  ) {}

  async refreshProfileEpisodicFollow(client: DbClient, profileId: string, limit = 100): Promise<MetadataRefreshResult> {
    const result = emptyResult();
    result.summary.skipped += 1;
    return result;
  }

  async refreshMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<MetadataRefreshResult> {
    return this.refreshIdentity(client, profileId, parseMediaKey(mediaKey));
  }

  async refreshIdentity(client: DbClient, profileId: string, identity: MediaIdentity): Promise<MetadataRefreshResult> {
    if (identity.mediaType === 'movie') {
      return {
        summary: await this.tmdbRefreshService.refreshIdentity(client, profileId, identity),
        mediaKeys: [identity.mediaKey],
      };
    }

    const showTmdbId = identity.mediaType === 'show'
      ? identity.tmdbId
      : showTmdbIdForIdentity(identity);

    if (!showTmdbId) {
      const result = emptyResult();
      result.summary.skipped += 1;
      return result;
    }

    const titleMediaKey = `show:tmdb:${showTmdbId}`;

    return {
      summary: await this.tmdbRefreshService.refreshShow(
        client,
        profileId,
        showTmdbId,
        identity.mediaType === 'season' || identity.mediaType === 'episode' ? identity.seasonNumber : null,
        undefined,
      ),
      mediaKeys: [titleMediaKey],
    };
  }
}
