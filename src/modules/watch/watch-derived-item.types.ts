import type { LandscapeCardView, RegularCardView } from '../metadata/metadata.types.js';
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

export type WatchedProductItem = WatchDerivedProductItem & {
  watchedAt: string;
  origins: string[];
};

export type WatchlistProductItem = WatchDerivedProductItem & {
  addedAt: string;
  origins: string[];
};

export type RatingProductItem = WatchDerivedProductItem & {
  rating: { value: number; ratedAt: string };
  origins: string[];
};
