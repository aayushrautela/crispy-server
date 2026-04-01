import type { CalendarItem } from '../watch/watch-read.types.js';
import type { ContinueWatchingProductItem } from '../watch/watch-derived-item.types.js';
import type { HomeRuntime } from './home.types.js';

export class HomeBuilderService {
  build(params: {
    continueWatching: ContinueWatchingProductItem[];
    calendarItems: CalendarItem[];
  }): HomeRuntime {
    const thisWeek = params.calendarItems.filter((item) => item.bucket === 'this_week').slice(0, 10);

    return {
      continueWatching: {
        id: 'continue-watching',
        title: 'Continue Watching',
        layout: 'landscape',
        source: 'canonical_watch',
        items: params.continueWatching,
      },
      thisWeek: {
        id: 'this-week',
        title: 'This Week',
        layout: 'landscape',
        source: 'canonical_calendar',
        items: thisWeek,
      },
    };
  }
}
