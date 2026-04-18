import type { DbClient } from '../../lib/db.js';
import { parseMediaKey, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';
import { TmdbRefreshService, type MetadataRefreshSummary } from './providers/tmdb-refresh.service.js';
import { MetadataRefreshQueryService } from './metadata-refresh-query.service.js';

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

function mergeResult(target: MetadataRefreshResult, incoming: MetadataRefreshResult): MetadataRefreshResult {
  target.summary.refreshedTitles += incoming.summary.refreshedTitles;
  target.summary.refreshedSeasons += incoming.summary.refreshedSeasons;
  target.summary.refreshedTrackedShows += incoming.summary.refreshedTrackedShows;
  target.summary.skipped += incoming.summary.skipped;
  target.summary.failures += incoming.summary.failures;
  for (const mediaKey of incoming.mediaKeys) {
    if (!target.mediaKeys.includes(mediaKey)) {
      target.mediaKeys.push(mediaKey);
    }
  }
  return target;
}

export class MetadataRefreshService {
  constructor(
    private readonly tmdbRefreshService = new TmdbRefreshService(),
    private readonly metadataRefreshQueryService = new MetadataRefreshQueryService(),
  ) {}

  async refreshProfileEpisodicFollow(client: DbClient, profileId: string, limit = 100): Promise<MetadataRefreshResult> {
    const result = emptyResult();
    const episodicFollow = await this.metadataRefreshQueryService.listEpisodicFollow(client, profileId, limit);

    if (episodicFollow.length === 0) {
      result.summary.skipped += 1;
      return result;
    }

    for (const row of episodicFollow) {
      try {
        mergeResult(result, await this.refreshEpisodicFollowRecord(client, profileId, row));
      } catch {
        result.summary.failures += 1;
      }
    }

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
    const episodicFollow = identity.contentId
      ? await this.metadataRefreshQueryService.getEpisodicFollowByContentId(client, profileId, identity.contentId)
      : await this.metadataRefreshQueryService.getEpisodicFollowByMediaKey(client, profileId, titleMediaKey);

    return {
      summary: await this.tmdbRefreshService.refreshShow(
        client,
        profileId,
        showTmdbId,
        identity.mediaType === 'season' || identity.mediaType === 'episode' ? identity.seasonNumber : null,
        episodicFollow
          ? {
              titleContentId: episodicFollow.titleContentId,
              seriesMediaKey: episodicFollow.seriesMediaKey,
              payload: episodicFollow.payload,
            }
          : undefined,
      ),
      mediaKeys: [titleMediaKey],
    };
  }

  private async refreshEpisodicFollowRecord(
    client: DbClient,
    profileId: string,
    row: Awaited<ReturnType<MetadataRefreshQueryService['listEpisodicFollow']>>[number],
  ): Promise<MetadataRefreshResult> {
    if (!row.showTmdbId) {
      return this.refreshMediaKey(client, profileId, row.seriesMediaKey);
    }

    return {
      summary: await this.tmdbRefreshService.refreshShow(
        client,
        profileId,
        row.showTmdbId,
        null,
        {
          titleContentId: row.titleContentId,
          seriesMediaKey: row.seriesMediaKey,
          payload: row.payload,
        },
      ),
      mediaKeys: [row.seriesMediaKey],
    };
  }
}
