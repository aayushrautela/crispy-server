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

export type WatchStateLookupInput = {
  mediaKey: string;
};
