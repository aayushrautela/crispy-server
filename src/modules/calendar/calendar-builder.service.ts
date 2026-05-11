import type { DbClient } from '../../lib/db.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import type { LandscapeCardView, MetadataCardView, RegularCardView } from '../metadata/metadata-card.types.js';
import { parseMediaKey } from '../identity/media-key.js';
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
    private readonly metadataCardService = new MetadataCardService(),
  ) {}

  async build(client: DbClient, profileId: string, limit: number): Promise<CalendarItem[]> {
    return [];
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
    return 'no_scheduled';
  }
}
