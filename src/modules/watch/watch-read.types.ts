import type { MetadataView } from '../metadata/tmdb.types.js';

export type HydratedWatchItem = {
  media: MetadataView;
  progress?: {
    positionSeconds: number | null;
    durationSeconds: number | null;
    progressPercent: number;
    status?: string;
    lastPlayedAt?: string;
  };
  watchedAt?: string;
  lastActivityAt?: string;
  payload?: Record<string, unknown>;
};

export type CalendarBucket = 'up_next' | 'this_week' | 'upcoming' | 'recently_released' | 'no_scheduled';

export type CalendarItem = {
  bucket: CalendarBucket;
  media: MetadataView;
  relatedShow: MetadataView;
  airDate: string | null;
  watched: boolean;
};
