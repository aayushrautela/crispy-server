import type { MediaItem, MediaPresentationHint } from '../metadata/media-item.types.js';
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

export type CanonicalWatchCollectionKind = 'continue-watching' | 'history' | 'watchlist' | 'ratings';

export type WatchCollectionPageInfo = {
  nextCursor: string | null;
  hasMore: boolean;
};

export type CanonicalWatchCollectionResponse<TItem> = {
  profileId: string;
  kind: CanonicalWatchCollectionKind;
  source: 'canonical_watch';
  generatedAt: string;
  items: TItem[];
  pageInfo: WatchCollectionPageInfo;
};

export type PaginatedWatchCollection<TItem> = {
  items: TItem[];
  pageInfo: WatchCollectionPageInfo;
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
  kind: 'watch_state';
  mediaItem: MediaItem;
  context: {
    progress: WatchProgressView | null;
    continueWatching: ContinueWatchingStateView | null;
    watched: WatchedStateView | null;
    watchlist: WatchlistStateView | null;
    rating: RatingStateView | null;
  };
  presentation: MediaPresentationHint | null;
  progress: WatchProgressView | null;
  continueWatching: ContinueWatchingStateView | null;
  watched: WatchedStateView | null;
  watchlist: WatchlistStateView | null;
  rating: RatingStateView | null;
};

export type CalendarBucket = 'up_next' | 'this_week' | 'upcoming' | 'recently_released' | 'no_scheduled';

export type CalendarItem = {
  bucket: CalendarBucket;
  kind: 'calendar_item';
  mediaItem: MediaItem;
  context: {
    bucket: CalendarBucket;
    airDate: string | null;
    watched: boolean;
    relatedShow: MediaItem;
  };
  presentation: MediaPresentationHint | null;
  airDate: string | null;
  watched: boolean;
};

export type CalendarResponse = {
  profileId: string;
  source: 'canonical_calendar';
  generatedAt: string;
  items: CalendarItem[];
};

export type ThisWeekResponse = {
  profileId: string;
  source: 'canonical_calendar';
  kind: 'this-week';
  generatedAt: string;
  items: CalendarItem[];
};
