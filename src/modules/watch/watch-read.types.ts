import type { LandscapeCardView, RegularCardView } from '../metadata/metadata-card.types.js';
import type { MetadataView } from '../metadata/metadata-detail.types.js';
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

export type CanonicalWatchCollectionKind = 'continue-watching' | 'watched' | 'watchlist' | 'ratings';

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
  media: LandscapeCardView;
  relatedShow: RegularCardView;
  airDate: string | null;
  watched: boolean;
};

export type CalendarResponse = {
  profileId: string;
  source: 'canonical_calendar';
  generatedAt: string;
  items: CalendarItem[];
};
