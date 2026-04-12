import type { LandscapeCardView, RegularCardView } from '../metadata/metadata-card.types.js';
import type { WatchProgressView } from './watch-state.types.js';

export type WatchCollectionCard = RegularCardView;

export type WatchDerivedProductItem = {
  media: WatchCollectionCard;
};

export type ContinueWatchingProductItem = Omit<WatchDerivedProductItem, 'media'> & {
  media: LandscapeCardView;
  id: string;
  progress: WatchProgressView;
  lastActivityAt: string;
  origins: string[];
  dismissible: boolean;
};

export type HistoryProductItem = WatchDerivedProductItem & {
  id: string;
  watchedAt: string;
  origins: string[];
};

export type WatchlistProductItem = WatchDerivedProductItem & {
  id: string;
  addedAt: string;
  origins: string[];
};

export type RatingProductItem = WatchDerivedProductItem & {
  id: string;
  rating: { value: number; ratedAt: string };
  origins: string[];
};
