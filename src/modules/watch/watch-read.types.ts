import type { MetadataCardView, MetadataView } from '../metadata/metadata.types.js';
import type {
  WatchProgressView,
  ContinueWatchingStateView,
  WatchedStateView,
  WatchlistStateView,
  RatingStateView,
  WatchStateLookupInput,
} from './watch-state.types.js';

export type {
  WatchProgressView,
  ContinueWatchingStateView,
  WatchedStateView,
  WatchlistStateView,
  RatingStateView,
  WatchStateLookupInput,
} from './watch-state.types.js';

export type HydratedWatchItem = {
  id?: string;
  media: MetadataCardView;
  progress?: WatchProgressView;
  watchedAt?: string;
  lastActivityAt?: string;
  payload?: Record<string, unknown>;
};

export type HydratedWatchlistItem = {
  media: MetadataCardView;
  addedAt: string;
  payload?: Record<string, unknown>;
};

export type HydratedRatingItem = {
  media: MetadataCardView;
  rating: RatingStateView;
  payload?: Record<string, unknown>;
};

export type CanonicalWatchCollectionKind = 'continue-watching' | 'history' | 'watchlist' | 'ratings';

export type CanonicalWatchCollectionResponse<TItem> = {
  profileId: string;
  kind: CanonicalWatchCollectionKind;
  source: 'canonical_watch';
  generatedAt: string;
  items: TItem[];
};

export type WatchStateEnvelope = {
  profileId: string;
  source: 'canonical_watch';
  generatedAt: string;
  item: WatchStateResponse;
};

export type WatchStatesEnvelope = {
  profileId: string;
  source: 'canonical_watch';
  generatedAt: string;
  items: WatchStateResponse[];
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
  media: MetadataCardView;
  relatedShow: MetadataCardView;
  airDate: string | null;
  watched: boolean;
};

export type CalendarResponse = {
  profileId: string;
  source: 'canonical_calendar';
  generatedAt: string;
  items: CalendarItem[];
};
