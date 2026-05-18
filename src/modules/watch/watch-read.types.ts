import type { WatchStateLookupInput } from './watch-state.types.js';

export type { WatchStateLookupInput } from './watch-state.types.js';

export type CanonicalWatchCollectionKind = 'continue-watching' | 'history' | 'watchlist' | 'ratings';

export type WatchCollectionPageInfo = {
  nextCursor: string | null;
  hasMore: boolean;
};

export type PaginatedWatchCollection<TItem> = {
  items: TItem[];
  pageInfo: WatchCollectionPageInfo;
};


