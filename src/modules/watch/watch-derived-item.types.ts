import type { MediaItemDto, MediaPresentationHint } from '../metadata/media-item.types.js';
import type { WatchProgressView } from './watch-state.types.js';

export type WatchDerivedProductItem = {
  kind: 'watch_history' | 'watchlist' | 'rating';
  mediaItem: MediaItemDto;
  context: Record<string, unknown>;
  presentation: MediaPresentationHint | null;
};

export type ContinueWatchingContext = {
  id: string;
  progress: WatchProgressView;
  lastActivityAt: string;
  origins: string[];
  dismissible: boolean;
};

export type ContinueWatchingProductItem = {
  kind: 'continue_watching';
  mediaItem: MediaItemDto;
  context: ContinueWatchingContext;
  presentation: MediaPresentationHint | null;
  id: string;
  progress: WatchProgressView;
  lastActivityAt: string;
  origins: string[];
  dismissible: boolean;
};

export type HistoryProductItem = {
  kind: 'watch_history';
  mediaItem: MediaItemDto;
  context: {
    id: string;
    eventType: string;
    occurredAt: string;
    watchedAt: string;
    origins: string[];
  };
  presentation: MediaPresentationHint | null;
  id: string;
  eventType: string;
  occurredAt: string;
  watchedAt: string;
  origins: string[];
};

export type WatchlistProductItem = {
  kind: 'watchlist';
  mediaItem: MediaItemDto;
  context: {
    id: string;
    addedAt: string;
    origins: string[];
  };
  presentation: MediaPresentationHint | null;
  id: string;
  addedAt: string;
  origins: string[];
};

export type RatingProductItem = {
  kind: 'rating';
  mediaItem: MediaItemDto;
  context: {
    id: string;
    rating: { value: number; ratedAt: string };
    origins: string[];
  };
  presentation: MediaPresentationHint | null;
  id: string;
  rating: { value: number; ratedAt: string };
  origins: string[];
};
