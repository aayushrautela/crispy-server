import type { DbClient } from '../../lib/db.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { MetadataScheduleService } from '../metadata/metadata-schedule.service.js';
import type { LandscapeCardView, MetadataCardView, RegularCardView } from '../metadata/metadata.types.js';
import { inferMediaIdentity, parseMediaKey, type MediaIdentity } from '../identity/media-key.js';
import { WatchExportService } from '../watch/watch-export.service.js';
import { TmdbCacheService } from '../metadata/providers/tmdb-cache.service.js';
import type { CalendarItem } from '../watch/watch-read.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function toRegularCard(card: MetadataCardView): RegularCardView | null {
  const posterUrl = card.images.posterUrl ?? card.artwork.posterUrl;
  if (!card.title || !posterUrl) {
    return null;
  }

  return {
    mediaType: card.mediaType,
    mediaKey: card.mediaKey,
    provider: card.provider,
    providerId: card.providerId,
    title: card.title,
    posterUrl,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genre: null,
    subtitle: card.subtitle,
  };
}

function toLandscapeCard(card: MetadataCardView, params: {
  relatedShow: MetadataCardView;
  airDate: string | null;
}): LandscapeCardView | null {
  const posterUrl = card.images.posterUrl ?? card.artwork.posterUrl ?? params.relatedShow.images.posterUrl ?? params.relatedShow.artwork.posterUrl;
  const backdropUrl = card.images.stillUrl
    ?? card.artwork.stillUrl
    ?? card.images.backdropUrl
    ?? card.artwork.backdropUrl
    ?? params.relatedShow.images.backdropUrl
    ?? params.relatedShow.artwork.backdropUrl
    ?? posterUrl;

  if (!card.title || !posterUrl || !backdropUrl) {
    return null;
  }

  return {
    mediaType: card.mediaType,
    mediaKey: card.mediaKey,
    provider: card.provider,
    providerId: card.providerId,
    title: card.title,
    posterUrl,
    backdropUrl,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genre: null,
    seasonNumber: card.seasonNumber,
    episodeNumber: card.episodeNumber,
    episodeTitle: card.title,
    airDate: params.airDate,
    runtimeMinutes: card.runtimeMinutes,
  };
}

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
      const relatedShowCard = toRegularCard(relatedShow);
      if (!relatedShowCard) {
        continue;
      }
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
              media: {
                mediaType: relatedShowCard.mediaType,
                mediaKey: relatedShowCard.mediaKey,
                provider: relatedShowCard.provider,
                providerId: relatedShowCard.providerId,
                title: relatedShowCard.title,
                posterUrl: relatedShowCard.posterUrl,
                backdropUrl: relatedShow.images.backdropUrl ?? relatedShow.artwork.backdropUrl ?? relatedShowCard.posterUrl,
                releaseYear: relatedShowCard.releaseYear,
                rating: relatedShowCard.rating,
                genre: relatedShowCard.genre,
                seasonNumber: null,
                episodeNumber: null,
                episodeTitle: null,
                airDate: null,
                runtimeMinutes: relatedShow.runtimeMinutes,
              },
              relatedShow: relatedShowCard,
              airDate: null,
              watched: false,
            });
            continue;
          }

          episodeToUse = { seasonNumber: fallback.seasonNumber, episodeNumber: fallback.episodeNumber, title: fallback.name, airDate: fallback.airDate };
        }

        const candidate = await this.buildTmdbCalendarItem(client, trackedIdentity, episodeToUse, relatedShow, relatedShowCard, watchedEpisodeKeys, nowMs);
        if (candidate) {
          items.push(candidate);
        }
        continue;
      }

      const schedule = await this.metadataScheduleService.getScheduleInfo(client, trackedIdentity);
      if (!schedule.nextEpisode) {
        items.push({
          bucket: 'no_scheduled',
            media: {
              mediaType: relatedShowCard.mediaType,
              mediaKey: relatedShowCard.mediaKey,
              provider: relatedShowCard.provider,
            providerId: relatedShowCard.providerId,
            title: relatedShowCard.title,
            posterUrl: relatedShowCard.posterUrl,
            backdropUrl: relatedShow.images.backdropUrl ?? relatedShow.artwork.backdropUrl ?? relatedShowCard.posterUrl,
            releaseYear: relatedShowCard.releaseYear,
            rating: relatedShowCard.rating,
            genre: relatedShowCard.genre,
            seasonNumber: null,
            episodeNumber: null,
            episodeTitle: null,
            airDate: null,
            runtimeMinutes: relatedShow.runtimeMinutes,
          },
          relatedShow: relatedShowCard,
          airDate: null,
          watched: false,
        });
        continue;
      }

      const candidate = await this.buildProviderCalendarItem(client, trackedIdentity, schedule.nextEpisode, relatedShow, relatedShowCard, watchedEpisodeKeys, nowMs);
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
    relatedShowCard: RegularCardView,
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
    const landscape = toLandscapeCard(media, { relatedShow, airDate: episode.airDate });
    if (!landscape) {
      return null;
    }

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

    return { bucket, media: landscape, relatedShow: relatedShowCard, airDate, watched };
  }

  private async buildProviderCalendarItem(
    client: DbClient,
    trackedIdentity: MediaIdentity,
    episode: { seasonNumber: number | null; episodeNumber: number | null; title: string | null; airDate: string | null },
    relatedShow: MetadataCardView,
    relatedShowCard: RegularCardView,
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
    const landscape = toLandscapeCard(media, { relatedShow, airDate: episode.airDate });
    if (!landscape) {
      return null;
    }

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

    return { bucket, media: landscape, relatedShow: relatedShowCard, airDate: episode.airDate, watched };
  }
}
