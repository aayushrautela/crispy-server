import type { LandscapeCardView, RegularCardView } from '../metadata/metadata-card.types.js';
import type { MediaItem, MediaPresentationHint } from '../metadata/media-item.types.js';
import type { WatchProgressView } from './watch-state.types.js';

export type WatchCollectionCard = RegularCardView;

export type WatchDerivedProductItem = {
  media: WatchCollectionCard;
  kind?: 'watch_history' | 'watchlist' | 'rating';
  mediaItem?: MediaItem;
  context?: Record<string, unknown>;
  presentation?: MediaPresentationHint | null;
};

export type ContinueWatchingContext = {
  id: string;
  progress: WatchProgressView;
  lastActivityAt: string;
  origins: string[];
  dismissible: boolean;
};

export type ContinueWatchingProductItem = Omit<WatchDerivedProductItem, 'media' | 'kind'> & {
  media: LandscapeCardView;
  kind?: 'continue_watching';
  mediaItem?: MediaItem;
  context?: ContinueWatchingContext;
  presentation?: MediaPresentationHint | null;
  id: string;
  progress: WatchProgressView;
  lastActivityAt: string;
  origins: string[];
  dismissible: boolean;
};

export type HistoryProductItem = WatchDerivedProductItem & {
  kind?: 'watch_history';
  mediaItem?: MediaItem;
  context?: {
    id: string;
    watchedAt: string;
    origins: string[];
  };
  presentation?: MediaPresentationHint | null;
  id: string;
  watchedAt: string;
  origins: string[];
};

export type WatchlistProductItem = WatchDerivedProductItem & {
  kind?: 'watchlist';
  mediaItem?: MediaItem;
  context?: {
    id: string;
    addedAt: string;
    origins: string[];
  };
  presentation?: MediaPresentationHint | null;
  id: string;
  addedAt: string;
  origins: string[];
};

export type RatingProductItem = WatchDerivedProductItem & {
  kind?: 'rating';
  mediaItem?: MediaItem;
  context?: {
    id: string;
    rating: { value: number; ratedAt: string };
    origins: string[];
  };
  presentation?: MediaPresentationHint | null;
  id: string;
  rating: { value: number; ratedAt: string };
  origins: string[];
};
