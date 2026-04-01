import type { CalendarItem } from '../watch/watch-read.types.js';
import type { ContinueWatchingProductItem } from '../watch/watch-derived-item.types.js';
import type { RecommendationSection } from '../recommendations/recommendation.types.js';

export type HomeRuntime = {
  continueWatching: {
    id: 'continue-watching';
    title: 'Continue Watching';
    layout: 'landscape';
    source: 'canonical_watch';
    items: ContinueWatchingProductItem[];
  };
  thisWeek: {
    id: 'this-week';
    title: 'This Week';
    layout: 'landscape';
    source: 'canonical_calendar';
    items: CalendarItem[];
  };
};

export type HomeSnapshot = {
  sourceKey: string | null;
  generatedAt: string | null;
  sections: RecommendationSection[];
};

export type HomeResponse = {
  profileId: string;
  source: 'canonical_home';
  generatedAt: string;
  runtime: HomeRuntime;
  snapshot: HomeSnapshot;
};
