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

/**
 * Phase 0 — Boundary seam type.
 * Internal refs carry ONLY itemId + per-user state (Brain 1).
 * No title/artwork/overview/genres — hydration happens at the route boundary
 * via MetadataCardService → toClientMediaCard (Brain 2).
 */
export type WatchInternalProgress = {
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressBps: number | null;
  played: boolean;
  playCount: number;
  isFavorite: boolean;
  rating: number | null;
  lastPlayedAt: string | null;
};

export type WatchInternalRef = {
  itemId: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  progress: WatchInternalProgress | null;
};


