import { HttpError } from '../../lib/errors.js';

export type WatchPageCursor = {
  sortValue: string;
  tieBreaker: string;
};

type SerializedWatchPageCursor = {
  v: 1;
  s: string;
  t: string;
};

export function encodeWatchPageCursor(cursor: WatchPageCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, s: cursor.sortValue, t: cursor.tieBreaker } satisfies SerializedWatchPageCursor), 'utf8')
    .toString('base64url');
}

export function decodeWatchPageCursor(cursor: string | null | undefined): WatchPageCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<SerializedWatchPageCursor>;
    if (parsed.v !== 1 || typeof parsed.s !== 'string' || typeof parsed.t !== 'string' || !parsed.s || !parsed.t) {
      throw new Error('invalid cursor payload');
    }
    return { sortValue: parsed.s, tieBreaker: parsed.t };
  } catch {
    throw new HttpError(400, 'Invalid pagination cursor.');
  }
}
