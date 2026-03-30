import { HttpError } from '../../../lib/errors.js';
import type { DbClient } from '../../../lib/db.js';
import { extractLastEpisodeToAir, extractNextEpisodeToAir } from './tmdb-episode-helpers.js';
import { TmdbCacheService } from './tmdb-cache.service.js';
import type { TmdbTitleRecord } from './tmdb.types.js';
import { showTmdbIdForIdentity, parseMediaKey, type MediaIdentity } from '../../identity/media-key.js';
import { TrackedSeriesRepository } from '../../watch/tracked-series.repo.js';

export type MetadataRefreshSummary = {
  refreshedTitles: number;
  refreshedSeasons: number;
  refreshedTrackedShows: number;
  skipped: number;
  failures: number;
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

function isNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.statusCode === 404;
}

function collectSeasonNumbers(title: TmdbTitleRecord | null, explicitSeasonNumber?: number | null): number[] {
  const seasonNumbers = new Set<number>();

  if (explicitSeasonNumber && Number.isFinite(explicitSeasonNumber) && explicitSeasonNumber > 0) {
    seasonNumbers.add(explicitSeasonNumber);
  }

  const nextEpisode = extractNextEpisodeToAir(title);
  if (nextEpisode?.seasonNumber) {
    seasonNumbers.add(nextEpisode.seasonNumber);
  }

  const lastEpisode = extractLastEpisodeToAir(title);
  if (lastEpisode?.seasonNumber) {
    seasonNumbers.add(lastEpisode.seasonNumber);
  }

  if (seasonNumbers.size === 0 && title?.numberOfSeasons && title.numberOfSeasons > 0) {
    seasonNumbers.add(title.numberOfSeasons);
  }

  return Array.from(seasonNumbers).sort((left, right) => left - right);
}

export class TmdbRefreshService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly trackedSeriesRepository = new TrackedSeriesRepository(),
  ) {}

  async refreshProfileTrackedSeries(client: DbClient, profileId: string, limit = 100): Promise<MetadataRefreshSummary> {
    const summary = emptySummary();
    const tracked = await this.trackedSeriesRepository.listForProfile(client, profileId, limit);

    if (tracked.length === 0) {
      summary.skipped += 1;
      return summary;
    }

    for (const row of tracked) {
      if (row.showTmdbId === null) {
        summary.skipped += 1;
        continue;
      }
      try {
        mergeSummary(summary, await this.refreshShow(client, profileId, row.showTmdbId));
      } catch (error) {
        if (isNotFoundError(error)) {
          summary.skipped += 1;
          continue;
        }
        summary.failures += 1;
      }
    }

    return summary;
  }

  async refreshMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<MetadataRefreshSummary> {
    return this.refreshIdentity(client, profileId, parseMediaKey(mediaKey));
  }

  async refreshIdentity(client: DbClient, profileId: string, identity: MediaIdentity): Promise<MetadataRefreshSummary> {
    if (identity.mediaType === 'movie' && identity.tmdbId) {
      const summary = emptySummary();
      const title = await this.tmdbCacheService.refreshTitle(client, 'movie', identity.tmdbId);
      if (title) {
        summary.refreshedTitles += 1;
      } else {
        summary.skipped += 1;
      }
      return summary;
    }

    const showTmdbId = showTmdbIdForIdentity(identity);
    if (!showTmdbId) {
      const summary = emptySummary();
      summary.skipped += 1;
      return summary;
    }

    return this.refreshShow(client, profileId, showTmdbId, identity.seasonNumber);
  }

  private async refreshShow(
    client: DbClient,
    profileId: string,
    showTmdbId: number,
    explicitSeasonNumber?: number | null,
  ): Promise<MetadataRefreshSummary> {
    const summary = emptySummary();
    const title = await this.tmdbCacheService.refreshTitle(client, 'tv', showTmdbId);
    if (!title) {
      summary.skipped += 1;
      return summary;
    }

    summary.refreshedTitles += 1;

    const seasonNumbers = collectSeasonNumbers(title, explicitSeasonNumber);
    for (const seasonNumber of seasonNumbers) {
      await this.tmdbCacheService.refreshSeason(client, showTmdbId, seasonNumber);
      summary.refreshedSeasons += 1;
    }

    await this.trackedSeriesRepository.updateMetadataState(client, {
      profileId,
      trackedMediaKey: `show:tmdb:${showTmdbId}`,
      nextEpisodeAirDate: extractNextEpisodeToAir(title)?.airDate ?? null,
      metadataRefreshedAt: new Date().toISOString(),
    });
    summary.refreshedTrackedShows += 1;

    return summary;
  }
}
