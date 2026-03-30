import type { DbClient } from '../../lib/db.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { MetadataScheduleService } from '../metadata/metadata-schedule.service.js';
import type { MetadataCardView } from '../metadata/metadata.types.js';
import { inferMediaIdentity, parseMediaKey, type MediaIdentity } from '../identity/media-key.js';
import { WatchExportService } from '../watch/watch-export.service.js';
import { TmdbCacheService } from '../metadata/providers/tmdb-cache.service.js';
import type { CalendarItem } from '../watch/watch-read.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class CalendarBuilderService {
  constructor(
    private readonly watchExportService = new WatchExportService(),
    private readonly metadataCardService = new MetadataCardService(),
    private readonly metadataScheduleService = new MetadataScheduleService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async build(client: DbClient, profileId: string, limit: number): Promise<CalendarItem[]> {
    const tracked = await this.watchExportService.listTrackedSeries(client, profileId, Math.max(limit, 20));
    const nowMs = Date.now();
    const items: CalendarItem[] = [];

    for (const row of tracked) {
      const trackedIdentity = parseMediaKey(row.trackedMediaKey);
      if (trackedIdentity.mediaType !== 'show' && trackedIdentity.mediaType !== 'anime') {
        continue;
      }

      const relatedShow = await this.metadataCardService.buildCardView(client, trackedIdentity);
      const watchedEpisodeKeys = await this.watchExportService.listWatchedEpisodeKeysForShow(client, profileId, row.trackedMediaKey);

      if (trackedIdentity.provider === 'tmdb' && trackedIdentity.providerId) {
        const tmdbId = Number(trackedIdentity.providerId);
        if (!tmdbId || !Number.isFinite(tmdbId)) {
          continue;
        }

        const title = await this.tmdbCacheService.getTitle(client, 'tv', tmdbId);
        if (!title) {
          continue;
        }

        const schedule = await this.metadataScheduleService.getScheduleInfo(client, trackedIdentity);
        let episodeToUse: { seasonNumber: number | null; episodeNumber: number | null; title: string | null; airDate: string | null } | null = schedule.nextEpisode;

        if (!episodeToUse) {
          const episodes = await this.tmdbCacheService.listEpisodesForShow(client, tmdbId);
          const fallback = episodes.find((episode) => {
            const key = `episode:tmdb:${tmdbId}:${episode.seasonNumber}:${episode.episodeNumber}`;
            return !watchedEpisodeKeys.includes(key);
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

          episodeToUse = { seasonNumber: fallback.seasonNumber, episodeNumber: fallback.episodeNumber, title: fallback.name, airDate: fallback.airDate };
        }

        const candidate = await this.buildTmdbCalendarItem(client, trackedIdentity, episodeToUse, relatedShow, watchedEpisodeKeys, nowMs);
        if (candidate) {
          items.push(candidate);
        }
        continue;
      }

      const schedule = await this.metadataScheduleService.getScheduleInfo(client, trackedIdentity);
      if (!schedule.nextEpisode) {
        items.push({
          bucket: 'no_scheduled',
          media: relatedShow,
          relatedShow,
          airDate: null,
          watched: false,
        });
        continue;
      }

      const candidate = await this.buildProviderCalendarItem(client, trackedIdentity, schedule.nextEpisode, relatedShow, watchedEpisodeKeys, nowMs);
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

  private async buildTmdbCalendarItem(
    client: DbClient,
    trackedIdentity: MediaIdentity,
    episode: { seasonNumber: number | null; episodeNumber: number | null; title: string | null; airDate: string | null },
    relatedShow: MetadataCardView,
    watchedEpisodeKeys: string[],
    nowMs: number,
  ): Promise<CalendarItem | null> {
    if (!trackedIdentity.providerId) {
      return null;
    }

    const tmdbId = Number(trackedIdentity.providerId);
    if (!tmdbId || !Number.isFinite(tmdbId)) {
      return null;
    }

    const mediaKey = `episode:tmdb:${tmdbId}:${episode.seasonNumber}:${episode.episodeNumber}`;
    const watched = watchedEpisodeKeys.includes(mediaKey);
    const media = await this.metadataCardService.buildCardView(
      client,
      inferMediaIdentity({
        mediaType: 'episode',
        provider: 'tmdb',
        parentProvider: 'tmdb',
        parentProviderId: tmdbId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
      }),
    );

    const airDate = episode.airDate;
    const airDateMs = airDate ? Date.parse(airDate) : null;
    let bucket: CalendarItem['bucket'];

    if (airDateMs === null) {
      bucket = 'no_scheduled';
    } else if (airDateMs <= nowMs - 7 * DAY_MS) {
      bucket = 'recently_released';
    } else if (airDateMs <= nowMs) {
      bucket = 'up_next';
    } else if (airDateMs <= nowMs + 7 * DAY_MS) {
      bucket = 'this_week';
    } else {
      bucket = 'upcoming';
    }

    return { bucket, media, relatedShow, airDate, watched };
  }

  private async buildProviderCalendarItem(
    client: DbClient,
    trackedIdentity: MediaIdentity,
    episode: { seasonNumber: number | null; episodeNumber: number | null; title: string | null; airDate: string | null },
    relatedShow: MetadataCardView,
    watchedEpisodeKeys: string[],
    nowMs: number,
  ): Promise<CalendarItem | null> {
    const episodeIdentity = inferMediaIdentity({
      mediaType: 'episode',
      provider: trackedIdentity.provider,
      parentProvider: trackedIdentity.provider,
      parentProviderId: trackedIdentity.providerId,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
    });

    const watched = watchedEpisodeKeys.includes(episodeIdentity.mediaKey);
    const media = await this.metadataCardService.buildCardView(client, episodeIdentity);

    const airDateMs = episode.airDate ? Date.parse(episode.airDate) : null;
    let bucket: CalendarItem['bucket'];

    if (airDateMs === null) {
      bucket = 'no_scheduled';
    } else if (airDateMs <= nowMs - 7 * DAY_MS) {
      bucket = 'recently_released';
    } else if (airDateMs <= nowMs) {
      bucket = 'up_next';
    } else if (airDateMs <= nowMs + 7 * DAY_MS) {
      bucket = 'this_week';
    } else {
      bucket = 'upcoming';
    }

    return { bucket, media, relatedShow, airDate: episode.airDate, watched };
  }
}