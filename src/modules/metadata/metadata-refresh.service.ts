import type { DbClient } from '../../lib/db.js';
import { parseMediaKey, parentMediaTypeForIdentity, showTmdbIdForIdentity, type MediaIdentity } from '../watch/media-key.js';
import { TrackedSeriesRepository, type TrackedSeriesRecord } from '../watch/tracked-series.repo.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { TmdbRefreshService, type MetadataRefreshSummary } from './providers/tmdb-refresh.service.js';

type TrackedMediaIdentity = MediaIdentity & {
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
    private readonly trackedSeriesRepository = new TrackedSeriesRepository(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async refreshProfileTrackedSeries(client: DbClient, profileId: string, limit = 100): Promise<MetadataRefreshSummary> {
    const summary = emptySummary();
    const tracked = await this.trackedSeriesRepository.listForProfile(client, profileId, limit);

    if (tracked.length === 0) {
      summary.skipped += 1;
      return summary;
    }

    for (const row of tracked) {
      try {
        mergeSummary(summary, await this.refreshTrackedSeriesRecord(client, profileId, row));
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

    const trackedIdentity = toTrackedIdentity(identity);
    if (!trackedIdentity) {
      const summary = emptySummary();
      summary.skipped += 1;
      return summary;
    }

    if (trackedIdentity.provider === 'tmdb') {
      return this.tmdbRefreshService.refreshMediaKey(client, profileId, trackedIdentity.mediaKey);
    }

    return this.refreshProviderTrackedIdentity(client, profileId, trackedIdentity);
  }

  private async refreshTrackedSeriesRecord(
    client: DbClient,
    profileId: string,
    row: TrackedSeriesRecord,
  ): Promise<MetadataRefreshSummary> {
    if (row.provider === 'tmdb') {
      if (!row.showTmdbId) {
        const summary = emptySummary();
        summary.skipped += 1;
        return summary;
      }
      return this.tmdbRefreshService.refreshMediaKey(client, profileId, row.trackedMediaKey);
    }

    return this.refreshMediaKey(client, profileId, row.trackedMediaKey);
  }

  private async refreshProviderTrackedIdentity(
    client: DbClient,
    profileId: string,
    trackedIdentity: TrackedMediaIdentity,
  ): Promise<MetadataRefreshSummary> {
    const summary = emptySummary();
    const context = await this.providerMetadataService.loadIdentityContext(client, trackedIdentity);
    if (!context?.title) {
      summary.skipped += 1;
      return summary;
    }

    await this.trackedSeriesRepository.updateMetadataState(client, {
      profileId,
      trackedMediaKey: trackedIdentity.mediaKey,
      nextEpisodeAirDate: context.nextEpisode?.airDate ?? null,
      metadataRefreshedAt: new Date().toISOString(),
    });

    summary.refreshedTitles += 1;
    summary.refreshedTrackedShows += 1;
    return summary;
  }
}

function toTrackedIdentity(identity: MediaIdentity): TrackedMediaIdentity | null {
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
      tmdbId: identity.parentProvider === 'tmdb' ? showTmdbIdForIdentity(identity) : null,
      showTmdbId: identity.parentProvider === 'tmdb' ? showTmdbIdForIdentity(identity) : null,
      seasonNumber: null,
      episodeNumber: null,
      absoluteEpisodeNumber: null,
      providerMetadata: identity.providerMetadata,
    };
  }

  return null;
}
