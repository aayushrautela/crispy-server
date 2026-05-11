import { encodeWatchPageCursor, type WatchPageCursor } from '../watch/watch-pagination.js';
import type { PaginatedWatchCollection } from '../watch/watch-read.types.js';
import type { SupabaseWatchReadRow } from './supabase-watch-read.mapper.js';

export function pageFromRows<T>(
  rows: SupabaseWatchReadRow[],
  requestedLimit: number,
  extractCursor: (row: SupabaseWatchReadRow) => WatchPageCursor,
  mapRow: (row: SupabaseWatchReadRow) => T,
): PaginatedWatchCollection<T> {
  const hasMore = rows.length > requestedLimit;
  const items = rows.slice(0, requestedLimit).map(mapRow);
  const lastRow = hasMore ? rows[requestedLimit - 1] : null;
  const nextCursor = lastRow ? encodeWatchPageCursor(extractCursor(lastRow)) : null;

  return {
    items,
    pageInfo: {
      hasMore,
      nextCursor,
    },
  };
}
