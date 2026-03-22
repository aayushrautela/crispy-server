import type { HydratedWatchItem } from '../watch/watch-read.types.js';
import type { CalendarItem } from '../watch/watch-read.types.js';
import type { HomeResponse } from './home.types.js';

export class HomeBuilderService {
  build(params: {
    continueWatching: HydratedWatchItem[];
    history: HydratedWatchItem[];
    calendarItems: CalendarItem[];
  }): HomeResponse {
    const upNext = params.calendarItems.filter((item) => item.bucket === 'up_next' || item.bucket === 'this_week').slice(0, 10);
    const recentlyReleased = params.calendarItems.filter((item) => item.bucket === 'recently_released').slice(0, 10);

    return {
      sections: [
        {
          id: 'continue-watching',
          title: 'Continue Watching',
          items: params.continueWatching,
        },
        {
          id: 'up-next',
          title: 'Up Next',
          items: upNext,
        },
        {
          id: 'this-week',
          title: 'This Week',
          items: params.calendarItems,
        },
        {
          id: 'recently-released',
          title: 'Recently Released',
          items: recentlyReleased,
        },
        {
          id: 'recent-history',
          title: 'Recent History',
          items: params.history,
        },
      ],
    };
  }
}
