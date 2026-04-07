import { HttpError } from '../../../lib/errors.js';
import type { DbClient } from '../../../lib/db.js';
import type { MediaIdentity } from '../../identity/media-key.js';
import type { ProviderEpisodeRecord } from '../metadata-card.types.js';
import { MetadataRefreshQueryService } from '../metadata-refresh-query.service.js';
import { WatchV2MetadataService } from '../../watch-v2/watch-v2-metadata.service.js';
import { KitsuCacheService } from './kitsu-cache.service.js';
import type { MetadataRefreshSummary } from './tmdb-refresh.service.js';

function emptySummary(): MetadataRefreshSummary {
  return {
    refreshedTitles: 0,
    refreshedSeasons: 0,
    refreshedTrackedShows: 0,
    skipped: 0,
    failures: 0,
  };
}

function compareEpisodes(left: ProviderEpisodeRecord, right: ProviderEpisodeRecord): number {
  const leftSeason = left.seasonNumber ?? 0;
  const rightSeason = right.seasonNumber ?? 0;
  if (leftSeason !== rightSeason) {
    return leftSeason - rightSeason;
  }

  const leftEpisode = left.episodeNumber ?? left.absoluteEpisodeNumber ?? 0;
  const rightEpisode = right.episodeNumber ?? right.absoluteEpisodeNumber ?? 0;
  return leftEpisode - rightEpisode;
}

function nextUpcomingEpisodeAirDate(episodes: ProviderEpisodeRecord[]): string | null {
  const now = Date.now();
  const sorted = [...episodes].sort(compareEpisodes);
  return sorted.find((episode) => {
    const airDate = episode.airDate?.trim();
    return airDate ? Date.parse(airDate) >= now : false;
  })?.airDate ?? null;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.statusCode === 404;
}

export class KitsuRefreshService {
  constructor(
    private readonly kitsuCacheService = new KitsuCacheService(),
    private readonly metadataRefreshQueryService = new MetadataRefreshQueryService(),
    private readonly watchV2MetadataService = new WatchV2MetadataService(),
  ) {}

  async refreshIdentity(client: DbClient, profileId: string, identity: MediaIdentity): Promise<MetadataRefreshSummary> {
    const summary = emptySummary();
    if (identity.provider !== 'kitsu' || !identity.providerId) {
      summary.skipped += 1;
      return summary;
    }

    try {
      const bundle = await this.kitsuCacheService.refreshTitleBundle(client, identity.providerId);
      summary.refreshedTitles += 1;

      const episodicFollow = identity.contentId
        ? await this.metadataRefreshQueryService.getEpisodicFollowByContentId(client, profileId, identity.contentId)
        : await this.metadataRefreshQueryService.getEpisodicFollowByMediaKey(client, profileId, identity.mediaKey);
      if (!episodicFollow) {
        summary.skipped += 1;
        return summary;
      }

      await this.watchV2MetadataService.upsertEpisodicFollowState(client, {
        profileId,
        titleContentId: episodicFollow.titleContentId,
        titleMediaKey: episodicFollow.seriesMediaKey,
        nextEpisodeAirDate: nextUpcomingEpisodeAirDate(bundle.episodes),
        metadataRefreshedAt: new Date().toISOString(),
        payload: episodicFollow.payload ?? {},
      });
      summary.refreshedTrackedShows += 1;
      return summary;
    } catch (error) {
      if (isNotFoundError(error)) {
        summary.skipped += 1;
        return summary;
      }
      throw error;
    }
  }
}
