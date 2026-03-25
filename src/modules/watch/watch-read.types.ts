import type { MetadataView } from '../metadata/tmdb.types.js';

export type WatchProgressView = {
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressPercent: number;
  status?: string;
  lastPlayedAt?: string;
};

export type ContinueWatchingStateView = {
  id: string;
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressPercent: number;
  lastActivityAt: string;
};

export type WatchedStateView = {
  watchedAt: string;
};

export type WatchlistStateView = {
  addedAt: string;
};

export type RatingStateView = {
  value: number;
  ratedAt: string;
};

export type HydratedWatchItem = {
  id?: string;
  media: MetadataView;
  progress?: WatchProgressView;
  watchedAt?: string;
  lastActivityAt?: string;
  payload?: Record<string, unknown>;
};

export type HydratedWatchlistItem = {
  media: MetadataView;
  addedAt: string;
  payload?: Record<string, unknown>;
};

export type HydratedRatingItem = {
  media: MetadataView;
  rating: RatingStateView;
  payload?: Record<string, unknown>;
};

export type WatchStateLookupInput = {
  mediaKey?: string;
  mediaType?: string;
  tmdbId?: number | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export type WatchStateResponse = {
  media: MetadataView;
  progress: WatchProgressView | null;
  continueWatching: ContinueWatchingStateView | null;
  watched: WatchedStateView | null;
  watchlist: WatchlistStateView | null;
  rating: RatingStateView | null;
  watchedEpisodeKeys: string[];
};

export type CalendarBucket = 'up_next' | 'this_week' | 'upcoming' | 'recently_released' | 'no_scheduled';

export type CalendarItem = {
  bucket: CalendarBucket;
  media: MetadataView;
  relatedShow: MetadataView;
  airDate: string | null;
  watched: boolean;
};

export type CalendarResponse = {
  generatedAt: string;
  items: CalendarItem[];
};
