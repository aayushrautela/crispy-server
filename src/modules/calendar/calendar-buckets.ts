import type { CalendarBucket } from './calendar.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Assigns a display bucket to every calendar entry. Entries must arrive in the
 * builder's canonical order (air date ascending).
 *
 * - `up_next`: first not-yet-aired episode per series (Jellyfin-style NextUp)
 * - `this_week`: later episodes airing within the current Mon-based UTC week
 * - `upcoming`: future episodes beyond this week
 * - `recently_released`: aired before today (within the calendar lookback window)
 * - `no_scheduled`: missing or unparseable air date
 */
export function resolveCalendarBuckets(
  entries: Array<{ showItemId: string; airDate: string | null }>,
  now: Date = new Date(),
): CalendarBucket[] {
  const nowDate = new Date(now.getTime());
  const startOfToday = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  const startOfWeek = startOfToday - nowDate.getUTCDay() * DAY_MS;
  const endOfWeek = startOfWeek + 7 * DAY_MS;

  const seenFutureShows = new Set<string>();
  return entries.map((entry) => {
    if (!entry.airDate) return 'no_scheduled';
    const airMs = Date.parse(entry.airDate);
    if (!Number.isFinite(airMs)) return 'no_scheduled';
    if (airMs < startOfToday) return 'recently_released';

    if (!seenFutureShows.has(entry.showItemId)) {
      seenFutureShows.add(entry.showItemId);
      return 'up_next';
    }
    if (airMs >= startOfWeek && airMs < endOfWeek) return 'this_week';
    return 'upcoming';
  });
}
