import type { DbClient } from '../../lib/db.js';
import { parseMediaKey, parentMediaTypeForIdentity, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';
import { KitsuRefreshService } from './providers/kitsu-refresh.service.js';
import { TmdbRefreshService, type MetadataRefreshSummary } from './providers/tmdb-refresh.service.js';
import { TvdbRefreshService } from './providers/tvdb-refresh.service.js';
import { MetadataRefreshQueryService } from './metadata-refresh-query.service.js';

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

export class MetadataRefreshService {
  constructor(
    private readonly tmdbRefreshService = new TmdbRefreshService(),
    private readonly metadataRefreshQueryService = new MetadataRefreshQueryService(),
    private readonly tvdbRefreshService = new TvdbRefreshService(),
    private readonly kitsuRefreshService = new KitsuRefreshService(),
  ) {}

  async refreshProfileEpisodicFollow(client: DbClient, profileId: string, limit = 100): Promise<MetadataRefreshSummary> {
    const summary = emptySummary();
    const episodicFollow = await this.metadataRefreshQueryService.listEpisodicFollow(client, profileId, limit);

    if (episodicFollow.length === 0) {
      summary.skipped += 1;
      return summary;
    }

    for (const row of episodicFollow) {
      try {
        mergeSummary(summary, await this.refreshEpisodicFollowRecord(client, profileId, row));
      } catch {
        summary.failures += 1;
      }
    }

    return summary;
  }

  async refreshMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<MetadataRefreshSummary> {
    return this.refreshIdentity(client, profileId, parseMediaKey(mediaKey));
  }

  async refreshIdentity(client: DbClient, profileId: string, identity: MediaIdentity): Promise<MetadataRefreshSummary> {
    if (identity.mediaType === 'movie') {
      return this.tmdbRefreshService.refreshIdentity(client, profileId, identity);
    }

    const seriesIdentity = toEpisodicSeriesIdentity(identity);
    if (!seriesIdentity) {
      const summary = emptySummary();
      summary.skipped += 1;
      return summary;
    }

    const showTmdbId = seriesIdentity.tmdbId ?? showTmdbIdForIdentity(seriesIdentity);
    if (showTmdbId) {
      const episodicFollow = seriesIdentity.contentId
        ? await this.metadataRefreshQueryService.getEpisodicFollowByContentId(client, profileId, seriesIdentity.contentId)
        : await this.metadataRefreshQueryService.getEpisodicFollowByMediaKey(client, profileId, seriesIdentity.mediaKey);
      return this.tmdbRefreshService.refreshShow(
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
      );
    }

    return this.refreshProviderSeriesIdentity(client, profileId, seriesIdentity);
  }

  private async refreshEpisodicFollowRecord(
    client: DbClient,
    profileId: string,
    row: Awaited<ReturnType<MetadataRefreshQueryService['listEpisodicFollow']>>[number],
  ): Promise<MetadataRefreshSummary> {
    if (row.showTmdbId) {
      return this.tmdbRefreshService.refreshShow(
        client,
        profileId,
        row.showTmdbId,
        null,
        {
          titleContentId: row.titleContentId,
          seriesMediaKey: row.seriesMediaKey,
          payload: row.payload,
        },
      );
    }

    return this.refreshMediaKey(client, profileId, row.seriesMediaKey);
  }

  private async refreshProviderSeriesIdentity(
    client: DbClient,
    profileId: string,
    seriesIdentity: EpisodicSeriesIdentity,
  ): Promise<MetadataRefreshSummary> {
    if (seriesIdentity.provider === 'tvdb') {
      return this.tvdbRefreshService.refreshIdentity(client, profileId, seriesIdentity);
    }
    if (seriesIdentity.provider === 'kitsu') {
      return this.kitsuRefreshService.refreshIdentity(client, profileId, seriesIdentity);
    }

    const summary = emptySummary();
    summary.skipped += 1;
    return summary;
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
