import type { DbClient } from '../../lib/db.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import type { LandscapeCardView, MetadataCardView, RegularCardView } from '../metadata/metadata-card.types.js';
import { parseMediaKey, type MediaIdentity } from '../identity/media-key.js';
import { WatchExportService } from '../watch/watch-export.service.js';
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
  ) {}

  async build(client: DbClient, profileId: string, limit: number): Promise<CalendarItem[]> {
    const episodicFollow = await this.watchExportService.listEpisodicFollow(client, profileId, Math.max(limit, 20));
    const nowMs = Date.now();
    const items: CalendarItem[] = [];

    for (const row of episodicFollow) {
      const seriesIdentity = parseMediaKey(row.seriesMediaKey);
      if (seriesIdentity.mediaType !== 'show') {
        continue;
      }

      const relatedShow = await this.metadataCardService.buildCardView(client, seriesIdentity);
      const relatedShowCard = toRegularCard(relatedShow);
      if (!relatedShowCard) {
        continue;
      }
      const watchedEpisodeKeys = await this.watchExportService.listWatchedEpisodeKeysForShow(client, profileId, row.seriesMediaKey);

      if (!row.nextEpisodeMediaKey) {
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

      const candidate = await this.buildCanonicalCalendarItem(client, {
        relatedShow,
        relatedShowCard,
        nextEpisodeMediaKey: row.nextEpisodeMediaKey,
        nextEpisodeAirDate: row.nextEpisodeAirDate,
        nextEpisodeTitle: row.nextEpisodeTitle,
        watchedEpisodeKeys,
        nowMs,
      });
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

  private async buildCanonicalCalendarItem(
    client: DbClient,
    params: {
      relatedShow: MetadataCardView;
      relatedShowCard: RegularCardView;
      nextEpisodeMediaKey: string;
      nextEpisodeAirDate: string | null;
      nextEpisodeTitle: string | null;
      watchedEpisodeKeys: string[];
      nowMs: number;
    },
  ): Promise<CalendarItem | null> {
    const episodeIdentity = parseMediaKey(params.nextEpisodeMediaKey);
    if (episodeIdentity.mediaType !== 'episode') {
      return null;
    }

    const watched = params.watchedEpisodeKeys.includes(episodeIdentity.mediaKey);
    const media = await this.metadataCardService.buildCardView(client, episodeIdentity);
    const landscape = toLandscapeCard(media, { relatedShow: params.relatedShow, airDate: params.nextEpisodeAirDate });
    if (!landscape) {
      return null;
    }

    if (params.nextEpisodeTitle && !landscape.episodeTitle) {
      landscape.episodeTitle = params.nextEpisodeTitle;
    }

    return {
      bucket: this.bucketForAirDate(params.nextEpisodeAirDate, params.nowMs),
      media: landscape,
      relatedShow: params.relatedShowCard,
      airDate: params.nextEpisodeAirDate,
      watched,
    };
  }

  private bucketForAirDate(airDate: string | null, nowMs: number): CalendarItem['bucket'] {
    const airDateMs = airDate ? Date.parse(airDate) : null;
    if (airDateMs === null) {
      return 'no_scheduled';
    }
    if (airDateMs <= nowMs - 7 * DAY_MS) {
      return 'recently_released';
    }
    if (airDateMs <= nowMs) {
      return 'up_next';
    }
    if (airDateMs <= nowMs + 7 * DAY_MS) {
      return 'this_week';
    }
    return 'upcoming';
  }
}
