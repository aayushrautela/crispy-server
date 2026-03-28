import type { DbClient } from '../../lib/db.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { extractNextEpisodeToAir } from '../metadata/tmdb-episode-helpers.js';
import { TmdbCacheService } from '../metadata/tmdb-cache.service.js';
import type { MetadataCardView } from '../metadata/metadata.types.js';
import type { TmdbEpisodeRecord } from '../metadata/tmdb.types.js';
import { inferMediaIdentity } from '../watch/media-key.js';
import { TrackedSeriesRepository } from '../watch/tracked-series.repo.js';
import { WatchHistoryRepository } from '../watch/watch-history.repo.js';
import type { CalendarItem } from '../watch/watch-read.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class CalendarBuilderService {
  constructor(
    private readonly trackedSeriesRepository = new TrackedSeriesRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly metadataViewService = new MetadataViewService(),
  ) {}

  async build(client: DbClient, profileId: string, limit: number): Promise<CalendarItem[]> {
    const tracked = await this.trackedSeriesRepository.listForProfile(client, profileId, Math.max(limit, 20));
    const nowMs = Date.now();
    const items: CalendarItem[] = [];

    for (const row of tracked) {
      const title = await this.tmdbCacheService.getTitle(client, 'tv', row.showTmdbId);
      if (!title) {
        continue;
      }

      const showIdentity = inferMediaIdentity({ mediaType: 'show', tmdbId: row.showTmdbId });
      const relatedShow = await this.metadataViewService.buildMetadataCardView(client, showIdentity);
      const watchedEpisodeKeys = await this.watchHistoryRepository.listWatchedEpisodeKeys(client, profileId, row.showTmdbId);
      const nextEpisode = extractNextEpisodeToAir(title);

      if (nextEpisode?.airDate) {
        const candidate = await this.buildCalendarItem(client, row.showTmdbId, nextEpisode, relatedShow, watchedEpisodeKeys, nowMs);
        if (candidate) {
          items.push(candidate);
          continue;
        }
      }

      const episodes = await this.tmdbCacheService.listEpisodesForShow(client, row.showTmdbId);
      const fallback = episodes.find((episode) => {
        const key = `episode:tmdb:${row.showTmdbId}:${episode.seasonNumber}:${episode.episodeNumber}`;
        return !watchedEpisodeKeys.has(key);
      });

      if (!fallback) {
        items.push({
          bucket: 'no_scheduled',
          media: relatedShow,
          relatedShow,
          airDate: null,
          watched: false,
        });
        continue;
      }

      const candidate = await this.buildCalendarItem(client, row.showTmdbId, fallback, relatedShow, watchedEpisodeKeys, nowMs);
      if (candidate) {
        items.push(candidate);
      }
    }

    return items
      .sort((left, right) => {
        const leftDate = left.airDate ? Date.parse(left.airDate) : Number.MAX_SAFE_INTEGER;
        const rightDate = right.airDate ? Date.parse(right.airDate) : Number.MAX_SAFE_INTEGER;
        return leftDate - rightDate;
      })
      .slice(0, limit);
  }

  private async buildCalendarItem(
    client: DbClient,
    showTmdbId: number,
    episode: TmdbEpisodeRecord,
    relatedShow: MetadataCardView,
    watchedEpisodeKeys: Set<string>,
    nowMs: number,
  ): Promise<CalendarItem | null> {
    const mediaKey = `episode:tmdb:${showTmdbId}:${episode.seasonNumber}:${episode.episodeNumber}`;
    const watched = watchedEpisodeKeys.has(mediaKey);
    const media = await this.metadataViewService.buildMetadataCardView(
      client,
      inferMediaIdentity({
        mediaType: 'episode',
        showTmdbId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        tmdbId: episode.tmdbId,
      }),
    );

    const airDate = episode.airDate;
    if (!airDate) {
      return {
        bucket: 'no_scheduled',
        media,
        relatedShow,
        airDate: null,
        watched,
      };
    }

    const deltaDays = Math.floor((Date.parse(airDate) - nowMs) / DAY_MS);
    let bucket: CalendarItem['bucket'];
    if (deltaDays <= 0 && deltaDays >= -7) {
      bucket = watched ? 'recently_released' : 'up_next';
    } else if (deltaDays <= 7) {
      bucket = 'this_week';
    } else {
      bucket = 'upcoming';
    }

    return {
      bucket,
      media,
      relatedShow,
      airDate,
      watched,
    };
  }
}
