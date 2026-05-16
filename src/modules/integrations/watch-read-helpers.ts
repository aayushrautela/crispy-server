import { encodeWatchPageCursor, type WatchPageCursor } from '../watch/watch-pagination.js';
import type { PaginatedWatchCollection } from '../watch/watch-read.types.js';
import type { WatchReadRow } from './watch-read.mapper.js';

export function pageFromRows<T>(
  rows: WatchReadRow[],
  requestedLimit: number,
  extractCursor: (row: WatchReadRow) => WatchPageCursor,
  mapRow: (row: WatchReadRow) => T,
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
