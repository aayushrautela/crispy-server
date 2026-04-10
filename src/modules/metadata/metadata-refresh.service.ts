import type { DbClient } from '../../lib/db.js';
import { parseMediaKey, parentMediaTypeForIdentity, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';
import { KitsuRefreshService } from './providers/kitsu-refresh.service.js';
import { TmdbRefreshService, type MetadataRefreshSummary } from './providers/tmdb-refresh.service.js';
import { TvdbRefreshService } from './providers/tvdb-refresh.service.js';
import { MetadataRefreshQueryService } from './metadata-refresh-query.service.js';

export type MetadataRefreshResult = {
  summary: MetadataRefreshSummary;
  mediaKeys: string[];
};

type EpisodicSeriesIdentity = MediaIdentity & {
  mediaType: 'show' | 'anime';
  provider: NonNullable<MediaIdentity['provider']>;
  providerId: NonNullable<MediaIdentity['providerId']>;
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

function mergeSummary(target: MetadataRefreshSummary, incoming: MetadataRefreshSummary): MetadataRefreshSummary {
  target.refreshedTitles += incoming.refreshedTitles;
  target.refreshedSeasons += incoming.refreshedSeasons;
  target.refreshedTrackedShows += incoming.refreshedTrackedShows;
  target.skipped += incoming.skipped;
  target.failures += incoming.failures;
  return target;
}

function emptyResult(): MetadataRefreshResult {
  return {
    summary: emptySummary(),
    mediaKeys: [],
  };
}

function mergeResult(target: MetadataRefreshResult, incoming: MetadataRefreshResult): MetadataRefreshResult {
  mergeSummary(target.summary, incoming.summary);
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
    private readonly tvdbRefreshService = new TvdbRefreshService(),
    private readonly kitsuRefreshService = new KitsuRefreshService(),
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

    const seriesIdentity = toEpisodicSeriesIdentity(identity);
    if (!seriesIdentity) {
      const result = emptyResult();
      result.summary.skipped += 1;
      return result;
    }

    const showTmdbId = seriesIdentity.tmdbId ?? showTmdbIdForIdentity(seriesIdentity);
    if (showTmdbId) {
      const episodicFollow = seriesIdentity.contentId
        ? await this.metadataRefreshQueryService.getEpisodicFollowByContentId(client, profileId, seriesIdentity.contentId)
        : await this.metadataRefreshQueryService.getEpisodicFollowByMediaKey(client, profileId, seriesIdentity.mediaKey);
      return {
        summary: await this.tmdbRefreshService.refreshShow(
          client,
          profileId,
          showTmdbId,
          identity.seasonNumber,
          episodicFollow
            ? {
                titleContentId: episodicFollow.titleContentId,
                seriesMediaKey: episodicFollow.seriesMediaKey,
                payload: episodicFollow.payload,
              }
            : undefined,
        ),
        mediaKeys: [seriesIdentity.mediaKey],
      };
    }

    return this.refreshProviderSeriesIdentity(client, profileId, seriesIdentity);
  }

  private async refreshEpisodicFollowRecord(
    client: DbClient,
    profileId: string,
    row: Awaited<ReturnType<MetadataRefreshQueryService['listEpisodicFollow']>>[number],
  ): Promise<MetadataRefreshResult> {
    if (row.showTmdbId) {
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

    return this.refreshMediaKey(client, profileId, row.seriesMediaKey);
  }

  private async refreshProviderSeriesIdentity(
    client: DbClient,
    profileId: string,
    seriesIdentity: EpisodicSeriesIdentity,
  ): Promise<MetadataRefreshResult> {
    if (seriesIdentity.provider === 'tvdb') {
      return {
        summary: await this.tvdbRefreshService.refreshIdentity(client, profileId, seriesIdentity),
        mediaKeys: [seriesIdentity.mediaKey],
      };
    }
    if (seriesIdentity.provider === 'kitsu') {
      return {
        summary: await this.kitsuRefreshService.refreshIdentity(client, profileId, seriesIdentity),
        mediaKeys: [seriesIdentity.mediaKey],
      };
    }

    const result = emptyResult();
    result.summary.skipped += 1;
    return result;
  }
}

function toEpisodicSeriesIdentity(identity: MediaIdentity): EpisodicSeriesIdentity | null {
  if ((identity.mediaType === 'show' || identity.mediaType === 'anime') && identity.provider && identity.providerId) {
    return {
      ...identity,
      mediaType: identity.mediaType,
      provider: identity.provider,
      providerId: identity.providerId,
    };
  }

  if ((identity.mediaType === 'season' || identity.mediaType === 'episode') && identity.parentProvider && identity.parentProviderId) {
    const mediaType = parentMediaTypeForIdentity(identity);
    if (mediaType !== 'show' && mediaType !== 'anime') {
      return null;
    }

    return {
      contentId: identity.parentContentId ?? null,
      mediaKey: `${mediaType}:${identity.parentProvider}:${identity.parentProviderId}`,
      mediaType,
      provider: identity.parentProvider,
      providerId: identity.parentProviderId,
      parentContentId: null,
      parentProvider: null,
      parentProviderId: null,
      tmdbId: showTmdbIdForIdentity(identity),
      showTmdbId: showTmdbIdForIdentity(identity),
      seasonNumber: null,
      episodeNumber: null,
      absoluteEpisodeNumber: null,
      providerMetadata: identity.providerMetadata,
    };
  }

  return null;
}
