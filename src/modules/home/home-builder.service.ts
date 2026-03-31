import type { CalendarItem } from '../watch/watch-read.types.js';
import type { ContinueWatchingProductItem, WatchedProductItem } from '../watch/watch-derived-item.types.js';
import type { HomeSection } from './home.types.js';

export class HomeBuilderService {
  build(params: {
    continueWatching: ContinueWatchingProductItem[];
    history: WatchedProductItem[];
    calendarItems: CalendarItem[];
  }): { sections: HomeSection[] } {
    const upNext = params.calendarItems.filter((item) => item.bucket === 'up_next').slice(0, 10);
    const thisWeek = params.calendarItems.filter((item) => item.bucket === 'this_week').slice(0, 10);
    const recentlyReleased = params.calendarItems.filter((item) => item.bucket === 'recently_released').slice(0, 10);

    return {
      sections: [
        {
          id: 'continue-watching',
          title: 'Continue Watching',
          kind: 'watch',
          source: 'canonical_watch',
          items: params.continueWatching,
        },
        {
          id: 'up-next',
          title: 'Up Next',
          kind: 'calendar',
          source: 'canonical_calendar',
          items: upNext,
        },
        {
          id: 'this-week',
          title: 'This Week',
          kind: 'calendar',
          source: 'canonical_calendar',
          items: thisWeek,
        },
        {
          id: 'recently-released',
          title: 'Recently Released',
          kind: 'calendar',
          source: 'canonical_calendar',
          items: recentlyReleased,
        },
        {
          id: 'recent-history',
          title: 'Recent History',
          kind: 'watch',
          source: 'canonical_watch',
          items: params.history,
        },
      ],
    };
  }
}
